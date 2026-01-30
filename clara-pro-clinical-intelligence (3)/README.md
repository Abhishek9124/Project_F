
# 🩺 CLARA Pro: Clinical Language & Reasoning Assistant

**CLARA Pro** is a production-level Clinical Intelligence Platform designed to transform unstructured patient-provider dialogues into structured, actionable medical data. By leveraging the **Google Gemini 3 Pro** reasoning engine and **Gemini 2.5 Native Audio** capabilities, CLARA provides real-time clinical synthesis, population health analytics, and HIPAA-ready audit trails.

---

## 🌟 Core Value Proposition

In modern healthcare, documentation accounts for up to 50% of a clinician's day. CLARA reduces this "cognitive tax" by:
1.  **Ambient Listening**: Capturing natural patient dialogue via native audio streaming.
2.  **Structured Synthesis**: Automatically mapping symptoms to ICD-10 codes and differential diagnoses.
3.  **Risk Stratification**: Identifying high-risk clinical markers before the patient leaves the room.
4.  **Population Oversight**: Providing administrators with visualized trends in prevalence and system health.

---

## 🚀 Key Features

### 1. Intelligent Intake (Multimodal)
*   **Live Dialogue Feed**: Real-time transcription using the Gemini Live API (`audio/pcm`).
*   **Contextual Awareness**: Distinguishes between provider queries and patient responses.
*   **Manual Override**: Supports pasting legacy clinical notes for batch synthesis.

### 2. Clinical reasoning Engine
*   **Automated ICD-10 Mapping**: High-precision billing code extraction.
*   **Differential Diagnoses**: Probabilistic modeling of potential conditions with clinical reasoning.
*   **Risk Assessment**: 0-100 score based on symptom severity and demographic history.
*   **Intervention Planning**: Suggested next steps and specialist referrals.

### 3. Population Health Analytics
*   **Prevalence Tracking**: Monitor the most frequent conditions across the registry.
*   **Risk Cohort Segmentation**: Visualize "Low", "Medium", and "High" risk groups.
*   **Demographic Disparity Analysis**: Identify risk trends across gender and age groups.
*   **System Performance**: Monitor API success rates and validation failures via the Audit Log.

### 4. Enterprise Security & Governance
*   **Immutable Audit Trail**: Every clinical action is timestamped and logged with a unique Event ID.
*   **Deployment Locking**: Finalized reports are "deployed" and hashed to prevent tampering.
*   **Clinical Dark Mode**: Optimized UI for low-light clinical environments (reducing eye strain).
*   **Data Interoperability**: One-click JSON export for ingestion into Epic, Cerner, or other EHRs.

---

## 🛠 Tech Stack

*   **Engine**: [Google Gemini 3 Pro](https://ai.google.dev/) (Advanced Reasoning)
*   **Real-time Audio**: [Gemini 2.5 Flash Native Audio](https://ai.google.dev/) (Native PCM Streaming)
*   **Visualization**: [Chart.js](https://www.chartjs.org/) (Clinical Analytics)
*   **Styling**: [Tailwind CSS](https://tailwindcss.com/) (Medical-grade Responsive UI)
*   **Storage**: Browser-native IndexedDB/LocalStorage (Privacy-first local persistence)

---

## 📂 Architecture

```text
├── index.html        # Platform shell & Clinical UI (Tailwind/Chart.js)
├── index.js          # Core logic: State Mgmt, Gemini API, Analytics
├── env.js            # Environment configuration (API Keys)
├── metadata.json     # Manifest & Permissions (Microphone)
└── README.md         # Documentation
```

---

## 🚦 Getting Started

### Prerequisites
*   **Gemini API Key**: Obtain from [Google AI Studio](https://aistudio.google.com/).

### Local Setup
1.  **Clone the repository** to your local environment.
2.  **Configure API Key**:
    *   Rename `env.js.example` to `env.js`.
    *   Paste your API Key into the `API_KEY` field.
3.  **Launch Server**:
    *   Run `npx serve .` in the root directory.
    *   Open `http://localhost:3000`.

---

## 🛡 Security & Privacy Notice

CLARA Pro is designed for **Privacy-First Clinical Operations**:
*   **Zero-Cloud Persistence**: Patient data stays in the browser's local storage unless explicitly exported.
*   **No Training Data**: API calls are configured to respect enterprise privacy standards (non-training mode).
*   **Auditability**: Every login and analysis is logged to a local immutable trail.

---

## 🔮 Future Roadmap

*   **Multimodal Vision**: Support for analyzing X-rays, EKGs, and lab results via Gemini Vision.
*   **EHR Plugins**: Direct "FHIR" standard connectors for Epic and Cerner.
*   **Predictive Outcomes**: Bayesian modeling to forecast treatment success based on historical population data.
*   **Voice Biometrics**: Security layer identifying the clinician via unique voice markers.

---

## 📄 License

This project is part of a clinical research initiative. For enterprise licensing or integration support, please contact the development team.

**Disclaimer**: *CLARA Pro is an AI-assisted tool. Clinical decisions must always be finalized by a licensed medical professional.*
