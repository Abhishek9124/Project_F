
import { GoogleGenAI, Type, Modality } from "@google/genai";

// --- PERSISTENCE & AUDIT ---
const DB_KEY = 'CLARA_PRO_V17';
const AUDIT_KEY = 'CLARA_AUDIT_V17';

const saveState = (patients) => localStorage.setItem(DB_KEY, JSON.stringify(patients));
const saveAudit = (log) => localStorage.setItem(AUDIT_KEY, JSON.stringify(log));

const loadState = () => {
    try {
        const data = localStorage.getItem(DB_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) { return []; }
};

const loadAudit = () => {
    try {
        const data = localStorage.getItem(AUDIT_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) { return []; }
};

function logEvent(action, resource, category = 'Success') {
    const log = loadAudit();
    const event = {
        timestamp: new Date().toISOString(),
        id: Math.random().toString(36).substr(2, 9).toUpperCase(),
        action, resource, category 
    };
    log.unshift(event);
    saveAudit(log.slice(0, 50));
}

// --- APP STATE ---
let state = {
    view: 'dashboard',
    patients: loadState(),
    activePatientId: null,
    isRecording: false,
    liveSession: null,
    inputAudioContext: null,
    outputAudioContext: null,
    nextStartTime: 0,
    sources: new Set(),
    darkMode: localStorage.getItem('theme') === 'dark',
    charts: {},
    assistantChat: null,
    currentSpeaker: 'Patient', 
    selectedLanguage: 'English',
    isVoiceAssistantActive: false,
    assistantVoiceSession: null,
    nearbyCare: null
};

// --- ENTERPRISE CLINICAL SCHEMA ---
const CLARA_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        summary: { type: Type.STRING, description: "Detailed clinical narrative of the encounter." },
        differential_diagnoses: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    condition: { type: Type.STRING },
                    probability: { type: Type.STRING },
                    reasoning: { type: Type.STRING },
                    icd10: { type: Type.STRING, description: "Relevant ICD-10 code for this diagnosis." }
                },
                required: ["condition", "probability", "reasoning", "icd10"]
            }
        },
        risk: {
            type: Type.OBJECT,
            properties: {
                score: { type: Type.INTEGER, description: "0-100 severity score." },
                level: { type: Type.STRING, description: "Routine, Stable, or Needs Review." },
                analysis: { type: Type.STRING }
            },
            required: ["score", "level", "analysis"]
        },
        treatment_plan: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    medication: { type: Type.STRING, description: "Drug name." },
                    purpose: { type: Type.STRING, description: "Clinical reason for use relative to the patient's specific condition and linked ICD-10 code." },
                    side_effects: { type: Type.STRING, description: "Key pharmacological side effects and adverse reactions." },
                    dosage_instructions: { type: Type.STRING },
                    dosage_adjustment_reason: { type: Type.STRING, description: "Reasoning for dosage based on patient age, vitals, or weight." },
                    icd10_link: { type: Type.STRING, description: "The specific ICD-10 code (from the diagnosis list) this medication is prescribed for." }
                },
                required: ["medication", "purpose", "side_effects", "dosage_instructions", "icd10_link"]
            }
        },
        safety_alerts: {
            type: Type.ARRAY,
            description: "Safety interactions and contraindications according to FDA/NIH clinical databases.",
            items: {
                type: Type.OBJECT,
                properties: {
                    severity: { type: Type.STRING, description: "Critical, Warning, or Informational." },
                    type: { type: Type.STRING, description: "Drug-Drug, Drug-Disease, or Allergy Alert." },
                    description: { type: Type.STRING },
                    rationale: { type: Type.STRING, description: "Deep clinical reasoning for the alert." }
                },
                required: ["severity", "type", "description", "rationale"]
            }
        },
        predictive_insight: { type: Type.STRING },
        recommendations: { 
            type: Type.ARRAY, 
            items: { 
                type: Type.OBJECT,
                properties: {
                    action: { type: Type.STRING },
                    rationale: { type: Type.STRING }
                },
                required: ["action", "rationale"]
            } 
        }
    },
    required: ["summary", "differential_diagnoses", "risk", "treatment_plan", "safety_alerts", "predictive_insight"]
};

// --- HELPERS ---
function encode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function decode(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
}

async function decodeAudioData(data, ctx, sampleRate, numChannels) {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}

async function getCoordinates() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
            () => resolve(null),
            { timeout: 10000 }
        );
    });
}

// --- UI EXPOSED HANDLERS ---
window.setLanguage = (lang) => {
    state.selectedLanguage = lang;
    logEvent('Language Changed', lang, 'Configuration');
};

window.setCurrentSpeaker = (speaker) => {
    state.currentSpeaker = speaker;
    const patientBtn = document.getElementById('speaker-btn-patient');
    const doctorBtn = document.getElementById('speaker-btn-doctor');
    const activeClass = 'bg-white shadow-sm text-blue-600';
    const inactiveClass = 'bg-transparent text-zinc-500';
    
    if (patientBtn && doctorBtn) {
        patientBtn.className = `px-6 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${speaker === 'Patient' ? activeClass : inactiveClass}`;
        doctorBtn.className = `px-6 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${speaker === 'Doctor' ? activeClass : inactiveClass}`;
    }
};

window.sendManualEncounterInput = () => {
    const input = document.getElementById('encounter-text-input');
    const text = input.value.trim();
    if (!text) return;
    const p = state.patients.find(pt => pt.id === state.activePatientId);
    if (p) {
        p.encounters.push({ speaker: 'Doctor', text, ts: Date.now() });
        input.value = '';
        saveState(state.patients);
        renderTranscript();
    }
};

// --- SEEDER ---
window.seedDemoData = () => {
    const scenarios = [
        { name: "Anita Sharma", age: 62, gender: "Female", condition: "Type 2 Diabetes & Hypertension", transcript: "I've been feeling very thirsty lately and my blood pressure was high at home, around 160 over 95. I'm also taking Metformin but noticed some dizziness when I stand up." },
        { name: "Robert Miller", age: 45, gender: "Male", condition: "Acute Lumbar Strain", transcript: "My lower back is killing me after moving some boxes yesterday. The pain radiates down my left leg slightly. I tried some Ibuprofen but it didn't help much." },
        { name: "Chloe Dupont", age: 29, gender: "Female", condition: "Migraine with Aura", transcript: "I'm seeing spots and have a throbbing headache on the right side. This happens every few months. Light is making it much worse." },
        { name: "Samuel Okoro", age: 74, gender: "Male", condition: "COPD Exacerbation", transcript: "I can't catch my breath, even just walking to the kitchen. My cough is producing more phlegm than usual, it looks yellowish." },
        { name: "Li Wei", age: 53, gender: "Non-binary", condition: "GERD & Gastritis", transcript: "Frequent heartburn after eating spicy food. It's a burning sensation in my chest that goes up to my throat. Antacids provide only temporary relief." },
        { name: "Elena Rossi", age: 38, gender: "Female", condition: "Generalized Anxiety Disorder", transcript: "My heart races randomly and I feel a constant sense of dread. I'm not sleeping well and I have tension in my shoulders all day." },
        { name: "Hiroshi Tanaka", age: 67, gender: "Male", condition: "Atrial Fibrillation", transcript: "My heart feels like it's fluttering or skipping beats. I feel lightheaded sometimes. I was prescribed Warfarin years ago but haven't been consistent." },
        { name: "Sarah Jenkins", age: 31, gender: "Female", condition: "Asthma Flare-up", transcript: "I've been wheezing since the pollen count went up. My rescue inhaler isn't working as well as it usually does. I feel tight in the chest." },
        { name: "Marcus Thorne", age: 41, gender: "Male", condition: "Hyperlipidemia", transcript: "Found out my cholesterol is high during a screening. No symptoms, but my father had a heart attack at 50 so I'm worried." },
        { name: "Sofia Mendez", age: 25, gender: "Female", condition: "Hypothyroidism", transcript: "I'm constantly exhausted, even after 10 hours of sleep. My skin is dry and I've gained weight without changing my diet." }
    ];

    const pts = scenarios.map((s, i) => {
        const dob = new Date(Date.now() - s.age * 31557600000).toISOString().split('T')[0];
        return {
            id: `PT-${6000 + i}`,
            name: s.name,
            dob,
            gender: s.gender,
            email: `${s.name.split(' ')[0].toLowerCase()}@hospital-demo.com`,
            phone: `+1-555-010${i}`,
            risk: Math.floor(Math.random() * 80) + 10,
            status: 'Draft',
            encounters: [
                { speaker: 'Doctor', text: 'How have you been feeling since our last visit?', ts: Date.now() - 100000 },
                { speaker: 'Patient', text: s.transcript, ts: Date.now() - 50000 }
            ],
            vitals: [{ systolic: 120 + i, diastolic: 80, hr: 72, pain: i%5, ts: Date.now() }],
            analysis: null,
            deployed: false
        };
    });
    state.patients = pts;
    saveState(pts);
    updateDashboard();
    renderPatientRegistry();
    alert("Enterprise Registry Synchronized with 10 Complex Cases.");
};

// --- NAVIGATION ---
window.setView = (view) => {
    state.view = view;
    document.querySelectorAll('main > div').forEach(d => d.classList.add('hidden'));
    document.getElementById(`view-${view}`)?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`nav-${view}`)?.classList.add('active');
    if (view === 'dashboard') updateDashboard();
    if (view === 'patients') renderPatientRegistry();
    if (view === 'analytics') window.renderAnalyticsView();
};

function updateDashboard() {
    const pts = state.patients;
    const statTotal = document.getElementById('stat-total-patients');
    const statActive = document.getElementById('stat-active-encounters');
    const statRisk = document.getElementById('stat-avg-risk');
    const statDeploy = document.getElementById('stat-deployments');
    
    if (statTotal) statTotal.innerText = pts.length;
    if (statActive) statActive.innerText = pts.filter(p => p.risk > 70).length;
    if (statRisk) statRisk.innerText = pts.length ? Math.round(pts.reduce((a,b)=>a+b.risk,0)/pts.length)+'%' : '0%';
    if (statDeploy) statDeploy.innerText = pts.filter(p => p.deployed).length;
    
    const tbody = document.getElementById('patient-table-body');
    if (tbody) {
        tbody.innerHTML = pts.slice(0, 10).map(p => {
            const primaryIcd = p.analysis?.differential_diagnoses?.[0]?.icd10 || '---';
            return `
            <tr class="border-b hover:bg-zinc-50 transition-all cursor-pointer group" onclick="window.viewPatient('${p.id}')">
                <td class="px-8 py-5 font-bold text-sm">${p.name} <br> <span class="text-[9px] text-zinc-400 font-mono">#${p.id}</span></td>
                <td class="px-8 py-5"><span class="px-3 py-1 rounded-full text-[9px] font-black uppercase ${p.risk > 70 ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}">${p.risk === 0 ? 'Draft' : p.status}</span></td>
                <td class="px-8 py-5"><span class="px-2 py-1 bg-zinc-100 text-zinc-600 rounded font-mono text-[10px] font-bold border">${primaryIcd}</span></td>
                <td class="px-8 py-5 font-mono text-sm">${p.risk}%</td>
                <td class="px-8 py-5 text-blue-600 font-black text-[10px] uppercase">Open Chart</td>
            </tr>
        `;}).join('') || '<tr><td colspan="5" class="p-10 text-center text-zinc-400">Registry Empty.</td></tr>';
    }
}

function renderPatientRegistry() {
    const grid = document.getElementById('patient-grid');
    if (grid) {
        grid.innerHTML = state.patients.map(p => {
            const primaryIcd = p.analysis?.differential_diagnoses?.[0]?.icd10 || 'PENDING';
            return `
            <div class="glass-card p-8 hover:border-blue-500 transition-all cursor-pointer group" onclick="window.viewPatient('${p.id}')">
                <div class="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center font-black text-zinc-500 mb-6 group-hover:bg-blue-600 group-hover:text-white transition-all">${p.name[0]}</div>
                <h4 class="font-bold text-sm truncate">${p.name}</h4>
                <div class="flex items-center gap-2 mt-2">
                    <p class="text-[9px] text-zinc-400 font-black uppercase tracking-widest">${p.id}</p>
                    <span class="text-[8px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-black border border-blue-100 icd-badge">${primaryIcd}</span>
                </div>
                <div class="mt-8 pt-6 border-t flex justify-between items-center">
                    <span class="text-[10px] font-black text-zinc-500">${p.risk}% RISK</span>
                    <span class="w-2 h-2 rounded-full ${p.risk > 70 ? 'bg-red-500' : 'bg-green-500'}"></span>
                </div>
            </div>
        `;}).join('');
    }
}

// --- CONVERSATIONAL VOICE ASSISTANT (HEALTH HUB) ---
window.startAssistantVoiceSession = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        state.inputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        state.outputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        state.nextStartTime = 0;
        state.sources = new Set();
        
        const setVoiceStatus = (text) => {
            const el = document.getElementById('voice-status-text');
            if (el) el.innerText = text;
        };

        const sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-12-2025',
            callbacks: {
                onopen: () => {
                    state.isVoiceAssistantActive = true;
                    document.getElementById('voice-overlay').classList.remove('hidden');
                    document.getElementById('assistant-status').classList.remove('hidden');
                    document.getElementById('btn-start-voice').classList.add('hidden');
                    document.getElementById('btn-stop-voice').classList.remove('hidden');
                    setVoiceStatus("Voice Link Established: Listening...");
                    
                    const source = state.inputAudioContext.createMediaStreamSource(stream);
                    const proc = state.inputAudioContext.createScriptProcessor(4096, 1, 1);
                    proc.onaudioprocess = (e) => {
                        if (!state.isVoiceAssistantActive) return;
                        const data = e.inputBuffer.getChannelData(0);
                        const int16 = new Int16Array(data.length);
                        for (let i = 0; i < data.length; i++) int16[i] = Math.max(-1, Math.min(1, data[i])) * 0x7FFF;
                        sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
                    };
                    source.connect(proc);
                    proc.connect(state.inputAudioContext.destination);
                },
                onmessage: async (msg) => {
                    if (msg.serverContent?.inputTranscription) {
                        appendAssistantMessage('user', msg.serverContent.inputTranscription.text, true);
                    }
                    if (msg.serverContent?.outputTranscription) {
                        appendAssistantMessage('ai', msg.serverContent.outputTranscription.text, true);
                    }

                    const base64Audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                    if (base64Audio) {
                        setVoiceStatus("CLARA is responding...");
                        state.nextStartTime = Math.max(state.nextStartTime, state.outputAudioContext.currentTime);
                        const buffer = await decodeAudioData(decode(base64Audio), state.outputAudioContext, 24000, 1);
                        const source = state.outputAudioContext.createBufferSource();
                        source.buffer = buffer;
                        source.connect(state.outputAudioContext.destination);
                        source.start(state.nextStartTime);
                        state.nextStartTime += buffer.duration;
                        state.sources.add(source);
                        source.onended = () => state.sources.delete(source);
                    }

                    if (msg.serverContent?.interrupted) {
                        for (const s of state.sources) { s.stop(); state.sources.delete(s); }
                        state.nextStartTime = 0;
                        setVoiceStatus("Listening...");
                    }

                    if (msg.serverContent?.turnComplete) {
                        setVoiceStatus("Ready for next query.");
                    }
                },
                onerror: (e) => { console.error("Voice Error", e); window.stopAssistantVoiceSession(); },
                onclose: () => { window.stopAssistantVoiceSession(); }
            },
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                systemInstruction: "You are CLARA, a friendly and expert clinical assistant. You respond vocally to help clinicians with protocols, drug interactions, and medical logic. Keep responses professional, clear, and concise."
            }
        });
        state.assistantVoiceSession = await sessionPromise;
    } catch (e) {
        console.error(e);
        alert("Could not initialize voice session. Check microphone permissions.");
    }
};

window.stopAssistantVoiceSession = () => {
    if (state.assistantVoiceSession) state.assistantVoiceSession.close();
    if (state.inputAudioContext) state.inputAudioContext.close();
    if (state.outputAudioContext) state.outputAudioContext.close();
    state.isVoiceAssistantActive = false;
    document.getElementById('voice-overlay').classList.add('hidden');
    document.getElementById('assistant-status').classList.add('hidden');
    document.getElementById('btn-start-voice').classList.remove('hidden');
    document.getElementById('btn-stop-voice').classList.add('hidden');
    logEvent('Voice Session Ended', 'Assistant Hub', 'Info');
};

function appendAssistantMessage(role, text, isStream = false) {
    const feed = document.getElementById('ai-chat-feed');
    if (!feed) return;
    
    let bubble = isStream ? feed.querySelector(`.live-${role}`) : null;
    if (!bubble) {
        bubble = document.createElement('div');
        bubble.className = `transcript-bubble ${role === 'ai' ? 'patient-bubble' : 'doctor-bubble'} ${isStream ? 'live-'+role : ''}`;
        feed.appendChild(bubble);
    }
    
    bubble.innerHTML = `
        <div class="role-badge">${role === 'ai' ? 'CLARA Assistant' : 'Physician'}</div>
        <p class="text-sm font-medium leading-relaxed">${text}</p>
    `;
    feed.scrollTop = feed.scrollHeight;
    
    if (!isStream) {
        bubble.classList.remove(`live-${role}`);
    }
}

// --- AMBIENT ENCOUNTER MODE ---
async function startLiveSession() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        state.inputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        
        let inBuffer = '';
        const setProcessingStatus = (text) => {
            const el = document.getElementById('processing-status-text');
            if (el) el.innerText = text;
        };

        const sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-12-2025',
            callbacks: {
                onopen: () => {
                    state.isRecording = true;
                    document.getElementById('live-indicator')?.classList.remove('hidden');
                    document.getElementById('btn-stop-gen')?.classList.remove('hidden');
                    document.getElementById('speaker-selector')?.classList.remove('hidden');
                    document.getElementById('btn-mic')?.classList.add('bg-red-600', 'text-white', 'animate-pulse');
                    window.setCurrentSpeaker('Patient');
                    setProcessingStatus("Microphone live: Listening...");
                    
                    const source = state.inputAudioContext.createMediaStreamSource(stream);
                    const proc = state.inputAudioContext.createScriptProcessor(4096, 1, 1);
                    proc.onaudioprocess = (e) => {
                        if (!state.isRecording) return;
                        const data = e.inputBuffer.getChannelData(0);
                        const int16 = new Int16Array(data.length);
                        for (let i = 0; i < data.length; i++) int16[i] = Math.max(-1, Math.min(1, data[i])) * 0x7FFF;
                        sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
                    };
                    source.connect(proc);
                    proc.connect(state.inputAudioContext.destination);
                },
                onmessage: async (msg) => {
                    document.getElementById('ai-processing-indicator')?.classList.remove('hidden');

                    if (msg.serverContent?.inputTranscription) {
                        inBuffer += msg.serverContent.inputTranscription.text;
                        setProcessingStatus(`Transcribing ${state.currentSpeaker}...`);
                        updateLiveStreamUI(state.currentSpeaker, inBuffer);
                    }
                    
                    if (msg.serverContent?.turnComplete) {
                        const p = state.patients.find(pt => pt.id === state.activePatientId);
                        if (p && inBuffer.trim()) {
                            p.encounters.push({ speaker: state.currentSpeaker, text: inBuffer.trim(), ts: Date.now() });
                            saveState(state.patients);
                            renderTranscript();
                        }
                        inBuffer = '';
                        setProcessingStatus("Dialogue segment finalized.");
                        setTimeout(() => {
                           if(state.isRecording) setProcessingStatus("Awaiting clinical input...");
                        }, 2000);
                        document.getElementById('ai-processing-indicator')?.classList.add('hidden');
                    }
                },
                onerror: (err) => {
                    console.error("Live session error:", err);
                    stopLiveSession();
                    setProcessingStatus("Session error detected.");
                },
                onclose: () => { 
                    state.isRecording = false; 
                    document.getElementById('live-indicator')?.classList.add('hidden');
                    document.getElementById('btn-mic')?.classList.remove('bg-red-600', 'text-white', 'animate-pulse');
                }
            },
            config: {
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {}, 
                systemInstruction: `You are an expert medical transcriptionist. Transcribe the audio from a clinical setting with high accuracy. The audio may be in ${state.selectedLanguage}.`
            }
        });
        state.liveSession = await sessionPromise;
    } catch (e) { 
        console.error(e);
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
            alert("Microphone permission denied. Please allow microphone access in your browser settings.");
        } else {
            alert("Could not access microphone.");
        }
    }
}

function stopLiveSession() {
    if (state.liveSession) state.liveSession.close();
    if (state.inputAudioContext && state.inputAudioContext.state !== 'closed') state.inputAudioContext.close();
    state.isRecording = false;
}

window.stopAndGenerateReport = () => {
    stopLiveSession();
    setTimeout(() => window.runAnalysis(), 1000);
};

function updateLiveStreamUI(speaker, text) {
    const feed = document.getElementById('transcript-feed');
    if (!feed) return;
    let bubble = feed.querySelector('.live-temp');
    if (!bubble) {
        bubble = document.createElement('div');
        bubble.className = 'transcript-bubble live-temp';
        feed.appendChild(bubble);
    }
    
    bubble.className = `transcript-bubble ${speaker === 'Doctor' ? 'doctor-bubble' : 'patient-bubble'} live-temp`;
    bubble.innerHTML = `
        <div class="role-badge">
            ${speaker}
            <div class="processing-indicator ml-2"><div class="dot"></div><div class="dot"></div></div>
        </div>
        <p class="text-sm font-medium leading-relaxed italic opacity-80">${text}</p>
    `;
    feed.scrollTop = feed.scrollHeight;
}

// --- CORE ANALYSIS ---
window.runAnalysis = async () => {
    const p = state.patients.find(pt => pt.id === state.activePatientId);
    if (!p || !p.encounters.length) return alert("Dialogue data required for synthesis.");
    const btn = document.getElementById('btn-analyze');
    btn.disabled = true; btn.innerText = "Consulting FDA/NIH Safety Protocols...";
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Perform a high-precision clinical synthesis and safety audit for: ${p.name}. 
        Profile: Born ${p.dob}, Gender ${p.gender}.
        Transcript (Language: ${state.selectedLanguage}): ${p.encounters.map(e => `${e.speaker}: ${e.text}`).join('\n')}.
        Return ONLY valid JSON based on the provided schema.`;
        
        const resp = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: CLARA_SCHEMA }
        });
        
        p.analysis = JSON.parse(resp.text.trim());
        p.risk = p.analysis.risk.score;
        p.status = p.analysis.risk.level;
        saveState(state.patients);
        window.switchTab('analysis');
        
        // Trigger Nearby Care search as part of synthesis
        window.findNearbySpecializedCare(p);
    } catch (e) { alert("Synthesis timeout or logic failure."); }
    finally { btn.disabled = false; btn.innerText = "Initiate Reasoning Engine"; }
};

window.findNearbySpecializedCare = async (patient) => {
    state.nearbyCare = { status: 'loading', results: [] };
    renderAnalysisPane(); // Refresh view to show loader
    
    try {
        const coords = await getCoordinates();
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const primaryCondition = patient.analysis?.differential_diagnoses?.[0]?.condition || "medical symptoms";
        
        const prompt = `Find specialized medical care, hospitals, or clinics nearby for a patient with: ${primaryCondition}. 
        Provide a few recommended facilities with their name and a brief reason why they are suitable.`;

        const config = {
            tools: [{ googleMaps: {} }],
        };

        if (coords) {
            config.toolConfig = {
                retrievalConfig: {
                    latLng: {
                        latitude: coords.latitude,
                        longitude: coords.longitude
                    }
                }
            };
        }

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: config
        });

        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const links = groundingChunks
            .filter(chunk => chunk.maps)
            .map(chunk => ({
                title: chunk.maps.title,
                uri: chunk.maps.uri
            }));

        state.nearbyCare = { 
            status: 'complete', 
            text: response.text,
            links: links
        };
        renderAnalysisPane();
    } catch (e) {
        console.error("Maps Grounding Error:", e);
        state.nearbyCare = { status: 'error', text: "Could not retrieve nearby facilities." };
        renderAnalysisPane();
    }
};

window.renderAnalysisPane = () => {
    const p = state.patients.find(pt => pt.id === state.activePatientId);
    const cont = document.getElementById('analysis-container');
    if (!p || !p.analysis) { cont.innerHTML = `<div class="p-32 text-center opacity-30 font-black text-xs uppercase tracking-[0.5em]">Synthesis Pending</div>`; return; }
    const d = p.analysis;
    
    let nearbyCareHtml = '';
    if (state.nearbyCare) {
        if (state.nearbyCare.status === 'loading') {
            nearbyCareHtml = `
                <div class="glass-card p-8 border-dashed border-2 flex items-center justify-center gap-4 text-zinc-400">
                    <div class="dot animate-bounce"></div><div class="dot animate-bounce delay-75"></div><div class="dot animate-bounce delay-150"></div>
                    <span class="text-[10px] font-black uppercase tracking-widest">Locating specialized infrastructure...</span>
                </div>`;
        } else if (state.nearbyCare.status === 'complete') {
            nearbyCareHtml = `
                <div class="glass-card p-10 bg-white border-blue-50 shadow-lg">
                    <h4 class="text-[11px] font-black text-blue-600 uppercase tracking-widest mb-6 flex items-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-width="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                        Nearby Specialized Infrastructure
                    </h4>
                    <div class="text-xs text-zinc-600 mb-6 leading-relaxed">${state.nearbyCare.text}</div>
                    <div class="flex flex-wrap gap-4">
                        ${state.nearbyCare.links.map(link => `
                            <a href="${link.uri}" target="_blank" class="flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-100 hover:bg-blue-600 hover:text-white transition-all shadow-sm">
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                ${link.title}
                            </a>
                        `).join('')}
                    </div>
                </div>`;
        }
    } else {
        nearbyCareHtml = `
            <button onclick="window.findNearbySpecializedCare(state.patients.find(pt => pt.id === state.activePatientId))" class="w-full glass-card p-6 border-zinc-200 border-dashed border-2 hover:bg-blue-50 text-zinc-400 hover:text-blue-600 transition-all text-[10px] font-black uppercase tracking-widest">
                Search for specialized facilities near you
            </button>`;
    }

    cont.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-10 pb-20">
            <div class="lg:col-span-2 space-y-10">
                <div class="glass-card p-10 bg-blue-50/20 border-blue-100">
                    <h4 class="text-[11px] font-black text-blue-600 uppercase tracking-widest mb-6">Integrated Clinical Narrative</h4>
                    <p class="text-base leading-relaxed text-zinc-800 font-medium italic">"${d.summary}"</p>
                </div>
                
                ${nearbyCareHtml}

                <div class="glass-card p-10 bg-white">
                    <h4 class="text-[11px] font-black text-zinc-400 uppercase tracking-widest mb-10">Differential Mapping (ICD-10 Primary Focus)</h4>
                    <div class="space-y-6">
                        ${d.differential_diagnoses.map(dx => `
                            <div class="p-6 border rounded-2xl bg-zinc-50/30 flex justify-between items-start group hover:bg-zinc-100 transition-all">
                                <div class="space-y-2 flex-1">
                                    <div class="flex items-center justify-between gap-4">
                                        <span class="font-black text-lg text-zinc-900">${dx.condition}</span>
                                        <span class="text-[11px] bg-blue-600 text-white px-3 py-1 rounded font-black icd-badge shadow-md">ICD-10: ${dx.icd10}</span>
                                    </div>
                                    <p class="text-xs text-zinc-500 leading-normal">${dx.reasoning}</p>
                                </div>
                                <span class="text-[10px] font-black bg-white border px-3 py-1 rounded-full uppercase text-zinc-400 ml-4">${dx.probability}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
            <div class="space-y-10">
                <div class="glass-card p-12 flex flex-col items-center">
                    <h4 class="text-[11px] font-black uppercase text-zinc-400 mb-8">Clinical Severity Score</h4>
                    <div class="text-7xl font-black ${d.risk.score > 70 ? 'text-red-600' : 'text-blue-600'} tracking-tighter">${d.risk.score}%</div>
                    <p class="text-[10px] font-black uppercase text-zinc-400 mt-8 text-center leading-tight">${d.risk.analysis}</p>
                </div>
            </div>
        </div>
    `;
};

// --- ANAlYTICS RENDERER ---
window.renderAnalyticsView = () => {
    if (state.charts.riskDist) state.charts.riskDist.destroy();
    if (state.charts.riskGender) state.charts.riskGender.destroy();

    const pts = state.patients;
    if (!pts.length) return;

    const riskDistCtx = document.getElementById('chart-risk-dist')?.getContext('2d');
    if (riskDistCtx) {
        state.charts.riskDist = new Chart(riskDistCtx, {
            type: 'doughnut',
            data: {
                labels: ['Low Risk', 'Moderate Risk', 'High Risk'],
                datasets: [{
                    data: [pts.filter(p => p.risk <= 30).length, pts.filter(p => p.risk > 30 && p.risk <= 70).length, pts.filter(p => p.risk > 70).length],
                    backgroundColor: ['#3b82f6', '#f97316', '#ef4444'],
                }]
            }
        });
    }
};

window.sendAssistantMessage = async () => {
    const input = document.getElementById('ai-chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendAssistantMessage('user', text);
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const chat = ai.chats.create({
            model: 'gemini-3-flash-preview',
            config: { systemInstruction: "You are CLARA, an advanced clinical assistant." }
        });
        const result = await chat.sendMessage({ message: text });
        appendAssistantMessage('ai', result.text);
    } catch (e) {
        appendAssistantMessage('ai', "Consultation timed out.");
    }
};

// --- CORE NAVIGATION & PATIENT HANDLERS ---
window.viewPatient = (id) => {
    state.activePatientId = id;
    state.nearbyCare = null; // Reset nearby care for new patient
    const p = state.patients.find(pt => pt.id === id);
    if (!p) return;
    const nameEl = document.getElementById('active-p-name');
    const idEl = document.getElementById('active-p-id');
    if (nameEl) nameEl.innerText = p.name;
    if (idEl) idEl.innerText = `#${p.id}`;
    window.setView('single-patient');
    window.switchTab('encounter');
    renderTranscript();
};

window.switchTab = (tab) => {
    document.querySelectorAll('#view-single-patient [id^="pane-"]').forEach(p => p.classList.add('hidden'));
    const pane = document.getElementById(`pane-${tab}`);
    if (pane) pane.classList.remove('hidden');
    
    document.querySelectorAll('#view-single-patient [id^="tab-"]').forEach(t => t.className = 'px-8 py-3 rounded-xl text-[10px] font-black uppercase transition-all text-zinc-500 tracking-widest');
    const active = document.getElementById(`tab-${tab}`);
    if (active) active.className = 'px-8 py-3 rounded-xl text-[10px] font-black uppercase transition-all bg-white shadow-sm text-blue-600 tracking-widest';
    if (tab === 'analysis') window.renderAnalysisPane();
};

function renderTranscript() {
    const p = state.patients.find(pt => pt.id === state.activePatientId);
    const feed = document.getElementById('transcript-feed');
    if (!p || !feed) return;
    feed.innerHTML = (p.encounters || []).map((e, i) => `
        <div class="transcript-bubble ${e.speaker === 'Doctor' ? 'doctor-bubble' : 'patient-bubble'} group">
            <div class="flex justify-between items-center">
                <span class="role-badge font-black">${e.speaker}</span>
            </div>
            <p class="text-sm font-medium leading-relaxed">${e.text}</p>
            <div class="role-selector group-hover:flex">
                <button onclick="window.setTurnRole('${p.id}', ${i}, 'Doctor')" class="px-3 py-2 text-[8px] font-black uppercase hover:bg-blue-600 hover:text-white rounded-lg">Doctor</button>
                <button onclick="window.setTurnRole('${p.id}', ${i}, 'Patient')" class="px-3 py-2 text-[8px] font-black uppercase hover:bg-zinc-600 hover:text-white rounded-lg ml-1">Patient</button>
            </div>
        </div>
    `).join('') || '<p class="text-center py-32 opacity-20 font-black text-xs uppercase tracking-widest">Ambient Channel Awaiting Audio</p>';
    feed.scrollTop = feed.scrollHeight;
}

window.setTurnRole = (pid, index, role) => {
    const p = state.patients.find(pt => pt.id === pid);
    if (!p) return;
    p.encounters[index].speaker = role;
    saveState(state.patients);
    renderTranscript();
};

window.handleIntakeSubmit = () => {
    const pt = {
        id: `PT-${Math.floor(Math.random()*9000)+1000}`,
        name: document.getElementById('intake-name').value,
        dob: document.getElementById('intake-dob').value,
        gender: document.getElementById('intake-gender').value,
        email: document.getElementById('intake-email').value,
        phone: document.getElementById('intake-phone').value,
        risk: 0, status: 'Draft', encounters: [], vitals: [], analysis: null, deployed: false
    };
    state.patients.unshift(pt);
    saveState(state.patients);
    window.hideIntakeModal();
    window.viewPatient(pt.id);
};

window.toggleDarkMode = () => {
    state.darkMode = !state.darkMode;
    document.body.classList.toggle('dark', state.darkMode);
    localStorage.setItem('theme', state.darkMode ? 'dark' : 'light');
    const thumb = document.getElementById('mode-toggle-thumb');
    if (thumb) thumb.style.left = state.darkMode ? '22px' : '2px';
};

window.hideIntakeModal = () => document.getElementById('intake-modal').classList.add('hidden');
document.getElementById('btn-mic')?.addEventListener('click', () => state.isRecording ? stopLiveSession() : startLiveSession());

if (state.darkMode) {
    document.body.classList.add('dark');
    const thumb = document.getElementById('mode-toggle-thumb');
    if (thumb) thumb.style.left = '22px';
}
window.setView('dashboard');
