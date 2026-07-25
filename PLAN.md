# System Architecture & Implementation Specification: BlindGrade

## 1. Executive Summary & Vision
**BlindGrade** is a cross-platform, privacy-first, zero-knowledge exam management and grading system. It is designed for educational environments, allowing teachers to generate exams, manage grades, and process physical scans without exposing student Personally Identifiable Information (PII) to the backend server. 

To accommodate strict institutional data policies, the system operates in two distinct modes: **Hybrid Zero-Knowledge Mode** (leveraging the server for blind storage) and **Strict Local Mode** (where the server acts purely as a stateless computation engine and all data resides locally in a single file on the teacher's hard drive). The architecture dynamically scales resource usage to run safely on legacy school hardware while fully exploiting the parallel processing power of modern environments like CachyOS.

## 2. Core Security, Privacy & Storage Models

### 2.1 Hybrid Zero-Knowledge Mode (Networked)
* **Plaintext Domain (Server Accessible):** Exam configurations (topics, max points, LaTeX templates, blank PDF outputs), and anonymized grades for statistical analysis.
* **Zero-Knowledge Domain (Client-Side Encrypted):** Student PII and the raw images/PDFs of their handwritten exam submissions. Encrypted in the browser via AES-256-GCM before transmission.

### 2.2 Strict Local Mode (Air-Gapped / Serverless Storage)
* **Zero Server Storage:** Absolutely no student data, encrypted blobs, or exam metadata is saved to the backend database. 
* **Stateless Backend:** The FastAPI server is only utilized as a stateless computation engine (e.g., compiling the plaintext LaTeX template into a blank PDF and immediately discarding it).
* **Single-File Portability:** The entire project state (Exam configurations, Student Identities, Grades, and sliced PDF scans) is maintained in the browser's local storage (IndexedDB) during the session. It is then serialized, compressed, and exported to the teacher's local hard drive as a single proprietary archive file (e.g., `.bgproj` or `.blindgrade`).
* **Session Restoration:** Teachers load the `.bgproj` file back into the browser via the HTML5 File API to resume grading, modify metadata, or view statistics.

### 2.3 Pseudonymization & Cryptography Architecture
1. **Pseudonym_ID Generation:** The client generates cryptographically secure UUIDs for each student.
2. **Client-Side Encryption:** PII and raw exam scans are encrypted before network transmission (in Hybrid Mode) or written to the local file archive (in Local Mode, enabling password-protected project files).
3. **QR Code Binding:** Generated blank exams feature a pre-printed QR code encoding the `Pseudonym_ID` to link the physical paper to the digital record.

## 3. Database Schema Design (Conceptual)
The schema acts as the ORM definition for the backend (Hybrid Mode) and maps directly to the IndexedDB structure on the frontend (Both Modes).

**Table: Exam (Plaintext)**
* Fields: ID, Title, LaTeX Template, Creation Date, Compilation Status.

**Table: Exercise (Plaintext)**
* Fields: ID, Exam ID, Max Points, Topic Tag.

**Table: StudentIdentity (Zero-Knowledge)**
* Fields: Pseudonym ID, Encrypted PII (AES-GCM blob), Initialization Vector (IV).

**Table: ScanSubmission (Zero-Knowledge / Hybrid)**
* Fields: ID, Exam ID, Pseudonym ID, Total Score, File Data (In Hybrid Mode: a pointer to the server disk path; In Local Mode: the raw/encrypted binary Blob stored in IndexedDB).

## 4. Frontend Architecture & Hardware Capability Routing
The client-side application aggressively adapts to the host machine's hardware capabilities and manages the complex local I/O required for the Single-File portability.

### 4.1 System Adaptive Matrix
* **Memory-Constrained Devices (e.g., older tablets, limited RAM):**
  * Strict "Assembly Line" memory model: Render one PDF page, scan QR, slice, encrypt, destroy canvas, force garbage collection.
  * Throttle IndexedDB writes sequentially.
* **Modern Workstations (e.g., multi-core CPUs, NVMe SSDs):**
  * Expansive Web Worker pool based on logical CPU core count.
  * Multi-page parallel memory buffering.
  * Enable WASM SIMD acceleration for the QR parsing engine and utilize unthrottled batch writes.

### 4.2 Local Export/Import Engine
* **Packer:** Utilizes Web Workers and a library like JSZip to asynchronously bundle the IndexedDB metadata, exercises, and heavy scan blobs into a compressed single file.
* **Unpacker:** Reads the single file into memory, streams the heavy scan blobs back into IndexedDB to prevent RAM exhaustion, and restores the UI state.

## 5. Backend Architecture (FastAPI & Tectonic)

### 5.1 Route Separation & Mode Handling
* **Plaintext Routes:** Endpoints for exam CRUD operations (ignored in Local Mode).
* **Zero-Knowledge Routes:** Endpoints for encrypted blind storage (ignored in Local Mode).
* **Stateless Computation Routes:** Endpoints that accept a LaTeX string, compile it via Tectonic, and return the PDF binary in the HTTP response without interacting with the database. This is the primary route utilized by the Strict Local Mode.

### 5.2 Asynchronous Compilation Engine
* LaTeX compilation via Tectonic is handled as an asynchronous background subprocess to prevent blocking the main HTTP event loop.
* The backend writes the LaTeX template to a temporary directory, executes Tectonic, captures the output, and instantly cleans up the temporary directory to maintain statelessness for Local Mode.

## 6. Implementation Roadmap for IDE Handoff

### Phase 1: Core Architecture, Cryptography & Workers
* Construct the client-side cryptographic service wrapper utilizing native APIs.
* Set up the Web Worker pool for QR extraction and implement the assembly line memory lifecycle.
* Build the hardware detection heuristics (CPU cores, RAM, WASM SIMD).

### Phase 2: Local Storage & Single-File Engine
* Implement the Dexie.js (IndexedDB) persistence layer for the frontend.
* Build the File API export/import pipeline to serialize the entire IndexedDB state into a downloadable `.bgproj` file.
* Ensure the unpacking mechanism streams data back into IndexedDB without causing Out-Of-Memory errors on large projects.

### Phase 3: FastAPI Backend & Asynchronous Compiler
* Scaffold the FastAPI application and define the database tables.
* Implement the asynchronous Tectonic execution wrapper, ensuring the "stateless compilation" endpoint is fully functional.
* Build the segmented API routes and the disk storage pipeline for the Hybrid Zero-Knowledge Mode.

## 7. Advanced Grading Features & Extensibility

### 7.1 Automated Multiple Choice & Optical Mark Recognition (OMR)
* **Client-Side OMR Engine:** To maintain the strict zero-knowledge privacy model, the evaluation of multiple-choice (MC), single-choice, and true/false questions must occur entirely in the browser. A WebAssembly (WASM) computer vision module (e.g., OpenCV.js) will handle the Optical Mark Recognition.
* **Fiducial Markers:** The generated LaTeX templates must include alignment markers (anchors) in the corners of the pages. The frontend uses these to deskew and normalize the perspective of the scanned images before attempting to read the MC bounding boxes.
* **Auto-Scoring Pipeline:** The plaintext exam configuration stores the correct MC answers and their point weights. During the local scan processing, the OMR engine maps the detected checkboxes, calculates the score, and automatically populates the grades for those specific exercises, leaving only free-text answers for manual review.

### 7.2 Digital Annotation & Feedback System
* **Non-Destructive Overlays:** Teachers must be able to "mark up" the digital exams (checkmarks, crosses, text comments, freehand drawing). This is captured via the HTML5 Canvas API.
* **Vector Storage:** Instead of permanently burning annotations into the scanned image blob (which increases file size and destroys the original), annotations are stored as a lightweight, encrypted JSON vector layer tied to the `ScanSubmission`.
* **Export Rendering:** When an exam is finalized, the frontend merges the raw scan blob and the vector annotation layer to generate a flattened PDF for the student or school archive.

### 7.3 Exam Randomization & Versioning
* **Seed-Based Shuffling:** To prevent cheating in tight classroom seating, the LaTeX generation engine supports permutation of both question order and multiple-choice options.
* **QR Version Mapping:** The specific randomization seed (Version A, B, C, etc.) is encoded into the student's unique QR code. When the frontend scans the paper, it reads the seed and automatically aligns the OMR engine to the correct grading key for that specific permutation.

### 7.4 Granular Rubrics & Grading Policies
* **Fractional & Penalty Scoring:** The data schema must support floating-point values (e.g., 0.5 points) and customizable penalty logic (e.g., -0.5 points for incorrect MC answers to discourage random guessing).
* **Competency Tagging (Didactic Analytics):** Individual exercises can be tagged with specific curriculum competencies (e.g., "Syntax," "Algorithmic Logic"). The client-side analytics engine aggregates these tags to generate heatmaps, showing exactly which concepts the 10th-grade class has mastered and which need review.

### 7.5 Grade Export & Administration Sync
* **System Integration:** Once grading is complete and identities are locally decrypted, the frontend provides a CSV/XLSX export explicitly formatted to map to standard school administration software (e.g., Notenmanager).
* **Statistical Dashboards:** Automated generation of class histograms, standard deviations, and average scores. In Hybrid Mode, these statistics are synchronized with the server using only the plaintext point totals, ensuring zero PII leakage while enabling longitudinal tracking across different classes.

### Phase 4: UI Integration & End-to-End Validation
* Connect the frontend framework to the hardware routing logic and storage modes.
* Verify both complete flows: Hybrid Mode (networked encryption/decryption) and Local Mode (exporting/importing the single file).
* Conduct stress tests with multi-page, high-resolution document batches across different hardware profiles.
