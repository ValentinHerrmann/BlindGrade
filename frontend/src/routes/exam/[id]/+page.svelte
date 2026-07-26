<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { db } from '$lib/db/db';
  import type { ExamRecord, ExerciseRecord, SubmissionRecord } from '$lib/db/schema';
  import { packProject } from '$lib/archive/packer';
  import { compileLatex } from '$lib/latex/compiler';
  import { api } from '$lib/api/client';
  import { sessionStore } from '$lib/stores/session';

  $: examId = $page.params.id || '';

  let exam: ExamRecord | null = null;
  let exercises: ExerciseRecord[] = [];
  let submissions: SubmissionRecord[] = [];
  let isExporting = false;
  let exportSuccess = false;

  let isCompiling = false;
  let compileNotice = '';
  let previewPdfUrl: string | null = null;

  $: if (examId) {
    loadExam(examId);
  }

  async function loadExam(id: string) {
    try {
      if ($sessionStore.mode === 'hybrid') {
        const remoteExam = await api.get(`/exams/${id}`);
        exam = {
          id: remoteExam.id,
          teacherId: remoteExam.teacher_id,
          title: remoteExam.title,
          testart: remoteExam.testart,
          klasse: remoteExam.klasse,
          datum: remoteExam.datum,
          nr: remoteExam.nr,
          fach: remoteExam.fach,
          lehrernachname: remoteExam.lehrernachname,
          infoText: remoteExam.info_text,
          retentionUntil: remoteExam.retention_until,
          compilationStatus: remoteExam.compilation_status,
          createdAt: remoteExam.created_at,
        };
        exercises = remoteExam.exercises.map((e: any) => ({
          id: e.id,
          name: e.name,
          topicTag: e.topic_tag,
          latexBody: e.latex_body,
          maxPoints: e.max_points,
          version: e.version || 1,
          orderIndex: e.order_index,
          questionType: e.question_type || 'free_text',
          penalty: e.penalty || 0,
        }));
      } else {
        exam = (await db.exams.get(id)) || null;
        const links = await db.examExercises.where('examId').equals(id).sortBy('orderIndex');
        if (links.length > 0) {
          exercises = [];
          for (const link of links) {
            const ex = await db.exercises.get(link.exerciseId);
            if (ex) {
              exercises.push({ ...ex, orderIndex: link.orderIndex });
            }
          }
        } else {
          exercises = await db.exercises.where('examId').equals(id).toArray();
        }
      }
      submissions = await db.submissions.where('examId').equals(id).toArray();
    } catch (err) {
      console.error('Failed to load exam from DB:', err);
    }
  }

  async function handleDeleteExam() {
    if (!exam) return;
    if (!confirm(`Are you sure you want to delete exam "${exam.title}" and all its submissions?`)) return;

    try {
      await db.exams.delete(exam.id);
      await db.exercises.where('examId').equals(exam.id).delete();
      await db.submissions.where('examId').equals(exam.id).delete();
      await db.students.where('examId').equals(exam.id).delete();

      if ($sessionStore.mode === 'hybrid') {
        try {
          await api.delete(`/exams/${exam.id}`);
        } catch (e) {
          console.warn('Failed to delete on server:', e);
        }
      }

      window.location.href = '/';
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  async function handleExportArchive() {
    const password = prompt('Enter password to encrypt .bgproj archive:');
    if (!password) return;

    isExporting = true;
    try {
      const bytes = await packProject(password);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exam?.title || 'exam'}.bgproj`;
      a.click();
      URL.revokeObjectURL(url);
      exportSuccess = true;
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      isExporting = false;
    }
  }

  async function handleDownloadExamPdf(showAnswers = false) {
    if (!exam) return;
    isCompiling = true;
    compileNotice = '';

    try {
      if ($sessionStore.mode === 'hybrid') {
        const pdfBuffer = await api.getBinary(`/exams/${exam.id}/compile?answers=${showAnswers}`);
        const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${exam.title}${showAnswers ? '_Loesung' : ''}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const exerciseInputs = exercises
          .map(
            (ex, idx) =>
              ex.latexBody ||
              `\\begin{Aufgabe}{${ex.name || `Aufgabe ${idx + 1}`}}\\end{Aufgabe}`
          )
          .join('\n\n');

        const opts = ['sans', 'punkte'];
        if (showAnswers) opts.push('antworten');

        const fullTex = `\\documentclass[a4paper]{article}
\\usepackage[${opts.join(',')}]{sty/Schulaufgabe}
\\Info{${exam.infoText || ''}}
\\Fach{${exam.fach || 'Informatik'}}
\\Lehrernachname{${exam.lehrernachname || ''}}
\\usepackage{bbding}
\\usepackage{pifont}
\\usepackage{fontspec}
\\usepackage{framed}
\\usepackage{enumitem}
\\usetikzlibrary{shapes.geometric, arrows}
\\usepackage{sty/tikz-uml}
\\neverindent
\\WarningsOff
\\begin{document}
\\Testart{${exam.testart || 'Kurzarbeit'}}
\\Klasse{${exam.klasse || ''}}
\\Datum{${exam.datum || ''}}
\\Nr{${exam.nr || '1'}}

${exerciseInputs}

\\end{document}`;

        const result = await compileLatex(fullTex);
        const blob = new Blob([result.pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${exam.title}${showAnswers ? '_Loesung' : ''}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }

      exam.compilationStatus = 'compiled';
      await db.exams.put(exam);
      compileNotice = `Downloaded ${showAnswers ? 'Solution / Answer Key' : 'Exam PDF'}.`;
    } catch (err: any) {
      if (exam) {
        exam.compilationStatus = 'failed';
        await db.exams.put(exam);
      }
      alert(`Compilation failed: ${err.message}`);
    } finally {
      isCompiling = false;
    }
  }
</script>

<div class="exam-detail-page">
  {#if !exam}
    <div class="loading">Loading exam details...</div>
  {:else}
    <div class="header">
      <div>
        <h2>{exam.title}</h2>
        <span class="meta">
          {exam.testart || 'Kurzarbeit'} | Klasse: {exam.klasse || '-'} | Datum: {exam.datum || '-'} | Retention until: {exam.retentionUntil}
        </span>
      </div>
      <div class="header-btns">
        <button class="delete-btn" on:click={handleDeleteExam}>Delete Exam</button>
        <button class="export-btn" on:click={handleExportArchive} disabled={isExporting}>
          {isExporting ? 'Packing...' : 'Export .bgproj Archive'}
        </button>
      </div>
    </div>

    {#if exportSuccess}
      <div class="success-banner">.bgproj archive successfully packed and downloaded.</div>
    {/if}

    <div class="pdf-compile-section">
      <h3>LaTeX Exam Compilation & Download</h3>
      <p class="desc">Generate printable A4 PDF exams using the Schulaufgabe template layout.</p>

      <div class="controls-row">
        <button class="compile-btn" on:click={() => handleDownloadExamPdf(false)} disabled={isCompiling}>
          {isCompiling ? 'Compiling...' : '📄 Download Exam PDF (Angabe)'}
        </button>

        <button class="solution-btn" on:click={() => handleDownloadExamPdf(true)} disabled={isCompiling}>
          {isCompiling ? 'Compiling...' : '📝 Download Answer Key (Lösung)'}
        </button>
      </div>

      {#if compileNotice}
        <div class="notice">{compileNotice}</div>
      {/if}
    </div>

    <div class="nav-cards">
      <a href="/exam/{examId}/scan" class="nav-card">
        <h3>1. Scan Ingestion</h3>
        <p>Upload PDF/images. Hardware-adaptive QR & OMR processing.</p>
        <span class="count">{submissions.length} Submissions</span>
      </a>

      <a href="/exam/{examId}/grade" class="nav-card">
        <h3>2. Grading View</h3>
        <p>Anonymous grading with vector canvas overlay.</p>
      </a>

      <a href="/exam/{examId}/stats" class="nav-card">
        <h3>3. Statistics & Export</h3>
        <p>Histogram, std dev, k-anonymity (k≥5) gate & CSV export.</p>
      </a>
    </div>

    <div class="exercises-summary">
      <h3>Configured Exercises ({exercises.length})</h3>
      <ul>
        {#each exercises as ex}
          <li>
            <span>Question {ex.orderIndex}: {ex.name || ex.title || 'Untitled'} ({ex.topicTag || 'General'})</span>
            <span class="pts">{ex.maxPoints} Pkt</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .exam-detail-page {
    max-width: 900px;
    margin: 2rem auto;
    padding: 1rem;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  h2 {
    margin: 0;
    color: #38bdf8;
  }

  .meta {
    font-size: 0.875rem;
    color: #94a3b8;
  }

  .header-btns {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .delete-btn {
    padding: 0.625rem 1rem;
    background: #ef4444;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .export-btn {
    padding: 0.625rem 1.25rem;
    background: #0284c7;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .pdf-compile-section {
    background: #1e293b;
    border: 1px solid #334155;
    padding: 1.5rem;
    border-radius: 10px;
    margin-bottom: 2rem;
  }

  .pdf-compile-section h3 {
    margin-top: 0;
    color: #38bdf8;
  }

  .pdf-compile-section .desc {
    font-size: 0.875rem;
    color: #94a3b8;
    margin-bottom: 1rem;
  }

  .controls-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .compile-btn {
    padding: 0.625rem 1.25rem;
    background: #0284c7;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .compile-btn:hover {
    background: #0369a1;
  }

  .solution-btn {
    padding: 0.625rem 1.25rem;
    background: #10b981;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .solution-btn:hover {
    background: #059669;
  }

  .notice {
    margin-top: 0.75rem;
    font-size: 0.875rem;
    color: #38bdf8;
  }

  .nav-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
    margin-bottom: 2.5rem;
  }

  .nav-card {
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 10px;
    border: 1px solid #334155;
    text-decoration: none;
    color: inherit;
    transition: transform 0.15s ease;
  }

  .nav-card:hover {
    transform: translateY(-2px);
    border-color: #38bdf8;
  }

  .nav-card h3 {
    margin: 0 0 0.5rem 0;
    color: #38bdf8;
  }

  .nav-card p {
    font-size: 0.875rem;
    color: #94a3b8;
    margin: 0 0 1rem 0;
  }

  .nav-card .count {
    font-size: 0.75rem;
    background: #0f172a;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    color: #cbd5e1;
  }

  .exercises-summary {
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 10px;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  li {
    display: flex;
    justify-content: space-between;
    padding: 0.75rem 0;
    border-bottom: 1px solid #334155;
  }

  .pts {
    font-weight: 600;
    color: #38bdf8;
  }

  .success-banner {
    background: rgba(34, 197, 94, 0.2);
    border: 1px solid #22c55e;
    color: #86efac;
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 1.5rem;
  }
</style>
