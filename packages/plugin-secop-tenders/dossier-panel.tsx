import { useCallback, useEffect, useRef, useState } from "react";
import { DossierForm } from "./dossier-form";
import {
  ArrowLeft,
  FileText,
  ListChecks,
  Building2,
  MessageSquare,
  RefreshCw,
  FolderOpen,
  FolderSync,
  ExternalLink,
  Upload,
  Check,
} from "lucide-react";
import type { PluginApi } from "@savia/plugin-sdk";
import { TenderDocuments } from "./tender-documents";
import { normalizeSecopRow, saveInterest, type SecopRow } from "./logic";
import {
  DossierClient,
  DOSSIER_CONNECTOR,
  safeDossierUploadUrl,
  dossierStateLabel,
  type DossierState,
  type CompanyDetail,
  type Company,
  type Stored,
  type Assessment,
  type Citation,
  type Job,
  type DossierDocument,
} from "./dossier";
import "./dossier-panel.css";
const copy = {
  es: {
    tabs: ["Resumen", "Documentos", "Requisitos", "Mi empresa", "Asistente"],
    evidence: "Ver evidencia",
    page: "pág.",
    back: "Volver a licitaciones",
    eyebrow: "EXPEDIENTE SECOP",
    headingFallback: "Expediente de la licitación",
    help: "Documentos, requisitos y preparación de la oferta en un mismo lugar.",
    updateDossier: "Actualizar expediente",
    prepareDossier: "Guardar y preparar expediente",
    update: "Actualizar",
    checking: "Comprobando conexión privada…",
    connectionError:
      "No se pudo comprobar la conexión privada. Vuelve a abrir el expediente.",
    loadError:
      "No se pudo cargar el expediente. Conservamos lo que ya estaba visible. Reintenta Actualizar.",
    invalidDossier:
      "El servicio devolvió un expediente inválido. Reintenta Actualizar.",
    changedDuringRead:
      "El expediente cambió durante la lectura. Actualiza para ver la nueva versión.",
    connectTitle: "Conectar el asistente de expedientes",
    connectHelp:
      "Usa la credencial privada de este espacio, distinta de la conexión pública de búsquedas SECOP. Se guardará como secreto en Savia.",
    credential: "Credencial del servicio",
    saveConnection: "Guardar conexión privada",
    legacy: "Ver documentos y análisis anteriores",
    tablist: "Expediente de la licitación",
    working: "Procesando en segundo plano. Puedes salir y volver.",
    cancel: "Cancelar trabajo",
    uploadLink: "Abrir carga privada del documento",
    uploadHint:
      "El enlace admite una carga durante 10 minutos. Después de cargar, pulsa Actualizar.",
    evidenceLabel: "Evidencia del documento",
    closeEvidence: "Cerrar evidencia",
    pageWord: "Página",
    section: "Sección",
    moreText: "Cargar más texto",
    prepareHeading: "Prepara el expediente completo",
    prepareHelp:
      "Guardaremos la licitación de interés y revisaremos la descripción, pliegos, anexos y adendas disponibles. Verás qué archivos se procesaron y qué falta.",
    jointAnalysis: "Análisis conjunto",
    pendingUpdate: "Pendiente de actualizar",
    completed: "Completado",
    catalogDocuments: "Documentos del catálogo",
    analyzedDocuments: "Documentos analizados",
    preparing: "En preparación",
    dossierVersion: "Versión del expediente",
    coverage:
      "Cobertura del catálogo público disponible en SECOP. Los archivos bloqueados, faltantes o sin extraer permanecen pendientes.",
    dossierChanged:
      "El expediente cambió. El informe anterior se conserva y requiere actualización.",
    reportSummary: "Resumen del expediente",
    viewAll: "Ver lista completa",
    pendingSources: "Revisión de fuentes pendiente: ",
    docsUnextracted: "documentos sin extraer y ",
    extractionsReview:
      "extracciones por revisar. El análisis conjunto y la revisión humana son pasos distintos.",
    conflicts: "Conflictos y adendas por revisar",
    jobHistory: "Historial de incidencias de procesamiento",
    unresolvedJob: "Trabajo pendiente de resolver: ",
    retryJob: "Reintentar trabajo",
    dossierDocuments: "Documentos del expediente",
    showing: "Mostrando ",
    of: " de ",
    emptyDocuments: "Sin documentos en el expediente",
    emptyDocumentsHelp:
      "Todavía no hay archivos registrados. Actualiza el expediente para consultar los documentos disponibles o revisa el catálogo público.",
    captchaHint:
      "Algunos archivos necesitan tu ayuda para completar la extracción. Revisa el estado de cada documento.",
    moreDocuments: "Cargar más documentos y requisitos",
    legacyDocuments: "Documentos públicos y análisis anteriores por PDF",
    sourcedRequirements: "Requisitos con fuente",
    prepareForRequirements:
      "Prepara el expediente para extraer los requisitos conjuntos.",
    mandatory: "Obligatorio",
    informative: "Informativo o puntuable",
    lot: "Lote",
    moreRequirements: "Cargar más requisitos",
    evaluateCompany: "Evaluar mi empresa",
    lotsToEvaluate: "Lotes a evaluar (opcional)",
    lotPlaceholder: "Identificadores de lote separados por comas",
    lotHelp:
      "En blanco se revisan todos los lotes. Usa los identificadores que aparecen en los requisitos.",
    company: "Empresa",
    selectCompany: "Selecciona una empresa",
    createCompany: "Crear perfil de empresa",
    companyName: "Nombre de la empresa",
    taxId: "Identificación tributaria",
    activity: "Actividad y capacidades",
    addCompanyEvidence: "Agregar evidencia de empresa",
    evaluate: "Evaluar cumplimiento",
    companyHelp:
      "Agrega certificados de experiencia, registros y estados financieros. Lo declarado en el perfil no reemplaza los documentos probatorios. Esta evaluación prepara la oferta; no presenta una postulación.",
    extractedFacts: "Datos extraídos de la empresa",
    factsHelp:
      "Confirma las cifras, unidades y períodos contra la fuente antes de usarlos en comparaciones numéricas.",
    reviewedFact: "Dato revisado",
    confirmFact: "Confirmo este dato y su evidencia",
    staleAssessment:
      "La empresa, sus evidencias o el expediente cambiaron. Vuelve a evaluar.",
    priorReviews:
      "Se conservan revisiones anteriores para volver a comprobarlas con estas fuentes.",
    missingToApply: "Qué falta para aplicar",
    teamReview: "Revisión del equipo:",
    addTeamReview: "Registrar revisión del equipo",
    decision: "Decisión",
    insufficient: "Falta evidencia",
    meets: "Cumple según revisión del equipo",
    doesNotMeet: "No cumple",
    notApplicable: "No aplica",
    justification: "Justificación",
    saveReview: "Guardar revisión",
    documentText: "Ver texto y citas",
    officialFile: "Archivo oficial",
    provideText: "Aportar versión con texto",
    reviewedExtraction: "Revisé la extracción completa",
    guideSteps: ["Guardar", "Procesar", "Evaluar", "Conversar"],
    guideNext: "Siguiente paso",
    guidePrepareHint:
      "Paso 1 de 4. Guarda la licitación y deja que el sistema lea todos los archivos. Un solo clic.",
    guideProcessingHint:
      "Paso 2 de 4. Estamos leyendo los archivos. Puedes salir y volver; te avisamos al terminar.",
    guideSynthesizingHint:
      "Paso 2 de 4. Archivos listos. Estamos generando el informe conjunto; si tarda demasiado, cancela el trabajo de síntesis y pulsa Actualizar para relanzarlo.",
    guideReviewHint:
      "Paso 2 de 4. El informe cambió o aún no existe. Pulsa Actualizar para regenerarlo.",
    guideCompanyHint:
      "Paso 3 de 4. Elige tu empresa y sube sus evidencias para poder comparar.",
    guideEvaluateHint:
      "Paso 3 de 4. Ya hay empresa y documentos. Pulsa Evaluar para ver qué te falta.",
    guideChatHint:
      "Paso 4 de 4. Todo listo. Pregunta en el chat con citas al documento original.",
    guideDocumentsReady: "documentos listos",
    guideGoCompany: "Ir a Mi empresa",
    guideGoChat: "Ir al asistente",
    assistantTitle: "Esta licitación, en el chat de Savia",
    assistantHelp:
      "Consulta las fuentes y genera un borrador de propuesta DOCX desde el chat. La licitación y la empresa seleccionadas acompañan cada acción.",
    companyForRequirements: "Empresa para contrastar requisitos",
    tenderOnly: "Solo la licitación",
    openAssistant: "Abrir chat de Savia",
    prepareList: "Preparar lista completa",
    companyNotCompared:
      "Aún no contrastamos el cumplimiento de tu empresa. Selecciona su perfil y aporta evidencias en «Mi empresa».",
    pendingDocs: " documentos siguen pendientes de extracción. ",
    extractedAll: "Todos los documentos disponibles tienen texto extraído. ",
    needsReview:
      " extracciones requieren revisión contra el original. El análisis automático no confirma cumplimiento.",
    prepareBeforeChat:
      "Primero prepara el expediente para conversar con sus documentos.",
    assistantUnavailable:
      "El chat integrado estará disponible al actualizar la plataforma. Tus conversaciones permanecen guardadas en el servicio.",
    genericError: "No se pudo completar la operación.",
    invalidTender: "No se pudo identificar la licitación.",
    invalidUpload: "El servicio devolvió un enlace de carga inválido.",
    savedInterest:
      "Guardamos la licitación de interés. El expediente se prepara en segundo plano.",
    companyCreated:
      "Empresa creada. Agrega su evidencia para evaluar los requisitos.",
    assistantUpdate:
      "El chat de Savia necesita la actualización de la plataforma. Recarga la página cuando termine el despliegue.",
    finishedJob: "El trabajo terminó. El expediente conserva sus resultados.",
    failedJob: "El trabajo requiere atención: ",
    pollError:
      "No pudimos actualizar el progreso. Tus archivos y trabajos permanecen guardados.",
    evidenceLoadError: "No se pudo cargar la evidencia del documento.",
    jobBackground: "El trabajo se prepara en segundo plano.",
  },
  en: {
    tabs: ["Summary", "Documents", "Requirements", "My company", "Assistant"],
    evidence: "View evidence",
    page: "p.",
    back: "Back to tenders",
    eyebrow: "SECOP DOSSIER",
    headingFallback: "Tender dossier",
    help: "Documents, requirements, and bid preparation in one place.",
    updateDossier: "Update dossier",
    prepareDossier: "Save and prepare dossier",
    update: "Refresh",
    checking: "Checking private connection…",
    connectionError:
      "Could not check the private connection. Reopen the dossier.",
    loadError:
      "Could not load the dossier. Previously visible content is retained. Try Refresh again.",
    invalidDossier:
      "The service returned an invalid dossier. Try Refresh again.",
    changedDuringRead:
      "The dossier changed while it was being read. Refresh to see the latest version.",
    connectTitle: "Connect the dossier assistant",
    connectHelp:
      "Use this workspace's private credential, separate from the public SECOP search connection. Savia stores it as a secret.",
    credential: "Service credential",
    saveConnection: "Save private connection",
    legacy: "View earlier documents and analyses",
    tablist: "Tender dossier",
    working: "Processing in the background. You can leave and return.",
    cancel: "Cancel job",
    uploadLink: "Open private document upload",
    uploadHint:
      "This link accepts one upload for 10 minutes. After uploading, select Refresh.",
    evidenceLabel: "Document evidence",
    closeEvidence: "Close evidence",
    pageWord: "Page",
    section: "Section",
    moreText: "Load more text",
    prepareHeading: "Prepare the complete dossier",
    prepareHelp:
      "We will save this tender to your interests and review its description, specifications, annexes, and available amendments. You will see what was processed and what is missing.",
    jointAnalysis: "Combined analysis",
    pendingUpdate: "Update pending",
    completed: "Complete",
    catalogDocuments: "Catalog documents",
    analyzedDocuments: "Documents analyzed",
    preparing: "Preparing",
    dossierVersion: "Dossier version",
    coverage:
      "Coverage of the public SECOP catalog. Blocked, missing, or unextracted files remain pending.",
    dossierChanged:
      "The dossier changed. The previous report is retained and needs an update.",
    reportSummary: "Dossier summary",
    viewAll: "View full list",
    pendingSources: "Source review pending: ",
    docsUnextracted: " documents not extracted and ",
    extractionsReview:
      " extractions to review. Combined analysis and human review are separate steps.",
    conflicts: "Conflicts and amendments to review",
    jobHistory: "Processing issue history",
    unresolvedJob: "Job needing attention: ",
    retryJob: "Retry job",
    dossierDocuments: "Dossier documents",
    showing: "Showing ",
    of: " of ",
    emptyDocuments: "No documents in this dossier",
    emptyDocumentsHelp:
      "No files have been registered yet. Update the dossier to check available documents or browse the public catalog.",
    captchaHint:
      "Some files need your help to complete extraction. Check each document’s status.",
    moreDocuments: "Load more documents and requirements",
    legacyDocuments: "Public documents and earlier PDF analyses",
    sourcedRequirements: "Requirements with sources",
    prepareForRequirements:
      "Prepare the dossier to extract combined requirements.",
    mandatory: "Mandatory",
    informative: "Informative or scored",
    lot: "Lot",
    moreRequirements: "Load more requirements",
    evaluateCompany: "Evaluate my company",
    lotsToEvaluate: "Lots to evaluate (optional)",
    lotPlaceholder: "Comma-separated lot identifiers",
    lotHelp:
      "Leave blank to review all lots. Use the identifiers shown in the requirements.",
    company: "Company",
    selectCompany: "Select a company",
    createCompany: "Create company profile",
    companyName: "Company name",
    taxId: "Tax ID",
    activity: "Activities and capabilities",
    addCompanyEvidence: "Add company evidence",
    evaluate: "Evaluate compliance",
    companyHelp:
      "Add experience certificates, registrations, and financial statements. Profile claims do not replace supporting documents. This evaluation prepares a bid; it does not submit one.",
    extractedFacts: "Extracted company facts",
    factsHelp:
      "Check figures, units, and periods against the source before using them in numeric comparisons.",
    reviewedFact: "Fact reviewed",
    confirmFact: "I confirm this fact and its evidence",
    staleAssessment:
      "The company, its evidence, or the dossier changed. Evaluate again.",
    priorReviews:
      "Earlier reviews are retained so you can check them again against these sources.",
    missingToApply: "What is missing to apply",
    teamReview: "Team review:",
    addTeamReview: "Record team review",
    decision: "Decision",
    insufficient: "Evidence missing",
    meets: "Meets based on team review",
    doesNotMeet: "Does not meet",
    notApplicable: "Not applicable",
    justification: "Rationale",
    saveReview: "Save review",
    documentText: "View text and citations",
    officialFile: "Official file",
    provideText: "Provide a text version",
    reviewedExtraction: "I reviewed the full extraction",
    guideSteps: ["Save", "Process", "Evaluate", "Chat"],
    guideNext: "Next step",
    guidePrepareHint:
      "Step 1 of 4. Save the tender and let the system read every file. One click.",
    guideProcessingHint:
      "Step 2 of 4. Reading the files. You can leave and come back.",
    guideSynthesizingHint:
      "Step 2 of 4. Files ready. Generating the joint report; if it takes too long, cancel the synthesis job and press Refresh to relaunch it.",
    guideReviewHint:
      "Step 2 of 4. The report changed or does not exist yet. Press Refresh to rebuild it.",
    guideCompanyHint:
      "Step 3 of 4. Pick your company and upload its evidence to compare.",
    guideEvaluateHint:
      "Step 3 of 4. Company and documents ready. Press Evaluate to see what is missing.",
    guideChatHint:
      "Step 4 of 4. All set. Ask in the chat with quotes from the original document.",
    guideDocumentsReady: "documents ready",
    guideGoCompany: "Go to My company",
    guideGoChat: "Go to the assistant",
    assistantTitle: "Discuss this tender in Savia chat",
    assistantHelp:
      "Discuss the dossier sources and generate a DOCX proposal draft from chat. The selected tender and company accompany each action.",
    companyForRequirements: "Company for requirement checks",
    tenderOnly: "Tender only",
    openAssistant: "Open Savia chat",
    prepareList: "Prepare full checklist",
    companyNotCompared:
      "Your company's compliance has not been checked yet. Select its profile and add evidence in “My company”.",
    pendingDocs: " documents still need extraction. ",
    extractedAll: "All available documents have extracted text. ",
    needsReview:
      " extractions need review against the original. Automated analysis does not confirm compliance.",
    prepareBeforeChat:
      "Prepare the dossier before chatting with its documents.",
    assistantUnavailable:
      "Integrated chat will be available after the platform is updated. Your conversations remain saved in the service.",
    genericError: "The operation could not be completed.",
    invalidTender: "Could not identify the tender.",
    invalidUpload: "The service returned an invalid upload link.",
    savedInterest:
      "The tender was saved to your interests. The dossier is preparing in the background.",
    companyCreated:
      "Company created. Add its evidence to evaluate the requirements.",
    assistantUpdate:
      "Savia chat needs a platform update. Reload the page after deployment finishes.",
    finishedJob: "The job finished. The dossier retains its results.",
    failedJob: "The job needs attention: ",
    pollError: "Could not update progress. Your files and jobs remain saved.",
    evidenceLoadError: "Could not load document evidence.",
    jobBackground: "The job is preparing in the background.",
  },
  pt: {
    tabs: ["Resumo", "Documentos", "Requisitos", "Minha empresa", "Assistente"],
    evidence: "Ver evidência",
    page: "pág.",
    back: "Voltar às licitações",
    eyebrow: "DOSSIÊ SECOP",
    headingFallback: "Dossiê da licitação",
    help: "Documentos, requisitos e preparação da proposta em um só lugar.",
    updateDossier: "Atualizar dossiê",
    prepareDossier: "Salvar e preparar dossiê",
    update: "Atualizar",
    checking: "Verificando conexão privada…",
    connectionError:
      "Não foi possível verificar a conexão privada. Abra o dossiê novamente.",
    loadError:
      "Não foi possível carregar o dossiê. O conteúdo já exibido foi mantido. Tente Atualizar novamente.",
    invalidDossier:
      "O serviço retornou um dossiê inválido. Tente Atualizar novamente.",
    changedDuringRead:
      "O dossiê mudou durante a leitura. Atualize para ver a versão mais recente.",
    connectTitle: "Conectar o assistente de dossiês",
    connectHelp:
      "Use a credencial privada deste espaço, separada da conexão pública de busca do SECOP. O Savia a armazenará como segredo.",
    credential: "Credencial do serviço",
    saveConnection: "Salvar conexão privada",
    legacy: "Ver documentos e análises anteriores",
    tablist: "Dossiê da licitação",
    working: "Processando em segundo plano. Você pode sair e voltar.",
    cancel: "Cancelar trabalho",
    uploadLink: "Abrir envio privado do documento",
    uploadHint:
      "Este link aceita um envio por 10 minutos. Depois do envio, selecione Atualizar.",
    evidenceLabel: "Evidência do documento",
    closeEvidence: "Fechar evidência",
    pageWord: "Página",
    section: "Seção",
    moreText: "Carregar mais texto",
    prepareHeading: "Prepare o dossiê completo",
    prepareHelp:
      "Vamos salvar a licitação nos seus interesses e revisar a descrição, o edital, os anexos e as adendas disponíveis. Você verá o que foi processado e o que falta.",
    jointAnalysis: "Análise conjunta",
    pendingUpdate: "Atualização pendente",
    completed: "Concluído",
    catalogDocuments: "Documentos do catálogo",
    analyzedDocuments: "Documentos analisados",
    preparing: "Em preparação",
    dossierVersion: "Versão do dossiê",
    coverage:
      "Cobertura do catálogo público disponível no SECOP. Arquivos bloqueados, ausentes ou sem extração permanecem pendentes.",
    dossierChanged:
      "O dossiê mudou. O relatório anterior foi mantido e precisa ser atualizado.",
    reportSummary: "Resumo do dossiê",
    viewAll: "Ver lista completa",
    pendingSources: "Revisão de fontes pendente: ",
    docsUnextracted: " documentos sem extração e ",
    extractionsReview:
      " extrações para revisar. Análise conjunta e revisão humana são etapas diferentes.",
    conflicts: "Conflitos e adendas para revisar",
    jobHistory: "Histórico de problemas de processamento",
    unresolvedJob: "Trabalho que precisa de atenção: ",
    retryJob: "Tentar trabalho novamente",
    dossierDocuments: "Documentos do dossiê",
    showing: "Exibindo ",
    of: " de ",
    emptyDocuments: "Nenhum documento no dossiê",
    emptyDocumentsHelp:
      "Ainda não há arquivos registrados. Atualize o dossiê para consultar os documentos disponíveis ou veja o catálogo público.",
    captchaHint:
      "Alguns arquivos precisam da sua ajuda para concluir a extração. Confira o estado de cada documento.",
    moreDocuments: "Carregar mais documentos e requisitos",
    legacyDocuments: "Documentos públicos e análises anteriores de PDF",
    sourcedRequirements: "Requisitos com fonte",
    prepareForRequirements:
      "Prepare o dossiê para extrair os requisitos conjuntos.",
    mandatory: "Obrigatório",
    informative: "Informativo ou pontuável",
    lot: "Lote",
    moreRequirements: "Carregar mais requisitos",
    evaluateCompany: "Avaliar minha empresa",
    lotsToEvaluate: "Lotes para avaliar (opcional)",
    lotPlaceholder: "Identificadores de lote separados por vírgula",
    lotHelp:
      "Deixe em branco para revisar todos os lotes. Use os identificadores exibidos nos requisitos.",
    company: "Empresa",
    selectCompany: "Selecione uma empresa",
    createCompany: "Criar perfil da empresa",
    companyName: "Nome da empresa",
    taxId: "Identificação fiscal",
    activity: "Atividades e capacidades",
    addCompanyEvidence: "Adicionar evidência da empresa",
    evaluate: "Avaliar conformidade",
    companyHelp:
      "Adicione certificados de experiência, registros e demonstrações financeiras. As declarações do perfil não substituem documentos comprobatórios. Esta avaliação prepara a proposta; não envia uma candidatura.",
    extractedFacts: "Dados extraídos da empresa",
    factsHelp:
      "Confira números, unidades e períodos na fonte antes de usá-los em comparações numéricas.",
    reviewedFact: "Dado revisado",
    confirmFact: "Confirmo este dado e sua evidência",
    staleAssessment:
      "A empresa, suas evidências ou o dossiê mudaram. Avalie novamente.",
    priorReviews:
      "As revisões anteriores foram mantidas para que você possa conferi-las novamente nestas fontes.",
    missingToApply: "O que falta para se candidatar",
    teamReview: "Revisão da equipe:",
    addTeamReview: "Registrar revisão da equipe",
    decision: "Decisão",
    insufficient: "Falta evidência",
    meets: "Atende segundo a revisão da equipe",
    doesNotMeet: "Não atende",
    notApplicable: "Não se aplica",
    justification: "Justificativa",
    saveReview: "Salvar revisão",
    documentText: "Ver texto e citações",
    officialFile: "Arquivo oficial",
    provideText: "Enviar versão com texto",
    reviewedExtraction: "Revisei a extração completa",
    guideSteps: ["Salvar", "Processar", "Avaliar", "Conversar"],
    guideNext: "Próximo passo",
    guidePrepareHint:
      "Passo 1 de 4. Salve a licitação e deixe o sistema ler todos os arquivos. Um clique.",
    guideProcessingHint:
      "Passo 2 de 4. Lendo os arquivos. Você pode sair e voltar.",
    guideSynthesizingHint:
      "Passo 2 de 4. Arquivos prontos. Gerando o relatório conjunto; se demorar demais, cancele o trabalho de síntese e atualize para relançar.",
    guideReviewHint:
      "Passo 2 de 4. O relatório mudou ou ainda não existe. Atualize para gerar de novo.",
    guideCompanyHint:
      "Passo 3 de 4. Escolha sua empresa e envie as evidências para comparar.",
    guideEvaluateHint:
      "Passo 3 de 4. Empresa e documentos prontos. Avalie para ver o que falta.",
    guideChatHint:
      "Passo 4 de 4. Tudo pronto. Pergunte no chat com citações do documento original.",
    guideDocumentsReady: "documentos prontos",
    guideGoCompany: "Ir para Minha empresa",
    guideGoChat: "Ir para o assistente",
    assistantTitle: "Converse sobre esta licitação no Savia",
    assistantHelp:
      "Consulte as fontes e gere um rascunho de proposta DOCX no chat. A licitação e a empresa selecionadas acompanham cada ação.",
    companyForRequirements: "Empresa para comparar requisitos",
    tenderOnly: "Somente a licitação",
    openAssistant: "Abrir chat do Savia",
    prepareList: "Preparar lista completa",
    companyNotCompared:
      "A conformidade da sua empresa ainda não foi verificada. Selecione o perfil e adicione evidências em “Minha empresa”.",
    pendingDocs: " documentos ainda aguardam extração. ",
    extractedAll: "Todos os documentos disponíveis têm texto extraído. ",
    needsReview:
      " extrações precisam ser conferidas com o original. A análise automática não confirma conformidade.",
    prepareBeforeChat: "Prepare o dossiê antes de conversar com os documentos.",
    assistantUnavailable:
      "O chat integrado estará disponível após a atualização da plataforma. Suas conversas continuam salvas no serviço.",
    genericError: "Não foi possível concluir a operação.",
    invalidTender: "Não foi possível identificar a licitação.",
    invalidUpload: "O serviço retornou um link de envio inválido.",
    savedInterest:
      "A licitação foi salva nos seus interesses. O dossiê está sendo preparado em segundo plano.",
    companyCreated:
      "Empresa criada. Adicione evidências para avaliar os requisitos.",
    assistantUpdate:
      "O chat do Savia precisa de uma atualização da plataforma. Recarregue a página após a implantação.",
    finishedJob: "O trabalho terminou. O dossiê mantém os resultados.",
    failedJob: "O trabalho precisa de atenção: ",
    pollError:
      "Não foi possível atualizar o progresso. Seus arquivos e trabalhos continuam salvos.",
    evidenceLoadError: "Não foi possível carregar a evidência do documento.",
    jobBackground: "O trabalho está sendo preparado em segundo plano.",
  },
} as const;
function CitationButtons({
  citations,
  onOpen,
  locale,
}: {
  citations: Citation[];
  onOpen: (id: string) => void;
  locale: "es" | "en" | "pt";
}) {
  const t = copy[locale];
  return (
    <div className="secop-dossier-actions">
      {Array.from(
        new Map(
          citations.map((c) => [
            `${c.documentVersionId}:${c.page ?? c.section ?? ""}`,
            c,
          ]),
        ).values(),
      ).map((c, i) => (
        <button
          key={`${c.documentVersionId}:${i}`}
          type="button"
          aria-label={`${t.evidence} ${i + 1}${c.page ? ` · ${t.page} ${c.page}` : ""}`}
          title={`${t.evidence} ${i + 1}${c.page ? ` · ${t.page} ${c.page}` : ""}`}
          className="secop-icon-action"
          onClick={() => onOpen(c.documentVersionId)}
        >
          <FileText size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
export function DossierPanel({
  savia,
  row,
  locale,
  onBack,
  tab: controlledTab,
  onTabChange,
}: {
  savia: PluginApi;
  row: SecopRow;
  locale: "es" | "en" | "pt";
  onBack: () => void;
  tab?: "summary" | "documents" | "requirements" | "company" | "chat";
  onTabChange?: (
    tab: "summary" | "documents" | "requirements" | "company" | "chat",
  ) => void;
}) {
  const t = copy[locale];
  const tabs = [
    ["summary", t.tabs[0], FolderOpen],
    ["documents", t.tabs[1], FileText],
    ["requirements", t.tabs[2], ListChecks],
    ["company", t.tabs[3], Building2],
    ["chat", t.tabs[4], MessageSquare],
  ] as const;
  const processId = String(row.process_id ?? "");
  const [legacy, setLegacy] = useState(false),
    [localTab, setLocalTab] = useState<
      "summary" | "documents" | "requirements" | "company" | "chat"
    >("summary");
  const tab = controlledTab ?? localTab;
  const selectTab = (
    next: "summary" | "documents" | "requirements" | "company" | "chat",
  ) => {
    setLocalTab(next);
    onTabChange?.(next);
  };
  const [client, setClient] = useState<DossierClient | null>(null),
    [initializing, setInitializing] = useState(true),
    [token, setToken] = useState("");
  const [snapshot, setSnapshot] = useState<DossierState | null>(null),
    [companies, setCompanies] = useState<Stored<Company>[]>([]),
    [companyId, setCompanyId] = useState(""),
    [detail, setDetail] = useState<CompanyDetail | null>(null),
    [assessment, setAssessment] = useState<Assessment | null>(null);
  const [pendingJob, setPendingJob] = useState<Job | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [uploadLink, setUploadLink] = useState<string | null>(null),
    [evidence, setEvidence] = useState<{
      document: Stored<DossierDocument>;
      chunks: Array<Stored<{ text: string; page?: number; section?: string }>>;
      nextOffset: number | null;
    } | null>(null);
  const [companyName, setCompanyName] = useState(""),
    [legalId, setLegalId] = useState(""),
    [activities, setActivities] = useState("");
  const snapshotRef = useRef<DossierState | null>(null);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  const [selectedLotsText, setSelectedLotsText] = useState("");
  const sequence = useRef(0),
    alive = useRef(true),
    pollLock = useRef(false);
  useEffect(() => {
    alive.current = true;
    setClient(new DossierClient(savia, DOSSIER_CONNECTOR));
    setInitializing(false);
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, [savia]);
  function isMissingConnection(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /connection.{0,40}(not configured|not found|missing)|conexión.{0,40}(no está configurada|no configurada|no se encontró)|configura la conexión/i.test(
      message,
    );
  }
  const refresh = useCallback(
    async (active = client) => {
      if (!active) return;
      const request = ++sequence.current;
      const [data, list] = await Promise.all([
        active.call<DossierState>("dossier", { id: processId, offset: 0 }),
        active.call<{ companies: Stored<Company>[] }>("companies", {
          offset: 0,
        }),
      ]);
      if (!alive.current || request !== sequence.current) return;
      if (
        !data ||
        !Array.isArray(data.documents) ||
        !Array.isArray(data.requirements) ||
        !Array.isArray(data.jobs) ||
        !Array.isArray(list?.companies)
      )
        throw new Error(t.invalidDossier);
      const loaded = Math.max(
        snapshotRef.current?.documents.length ?? 0,
        snapshotRef.current?.requirements.length ?? 0,
      );
      // Load every inventory page up front (bounded) so progress and counts
      // never depend on the user pressing "load more". Pages the user
      // already appended manually are always retained across refreshes.
      // Each page is small collection metadata; polling already refetches
      // the loaded set.
      const MAX_DOSSIER_PAGES = 25;
      for (
        let offset = 20, pages = 1;
        data.nextOffset !== null &&
        (pages < MAX_DOSSIER_PAGES || offset < loaded);
        offset += 20, pages++
      ) {
        const next = await active.call<DossierState>("dossier", {
          id: processId,
          offset,
        });
        if (
          next.dossier?.value.corpusRevision !==
          data.dossier?.value.corpusRevision
        )
          throw new Error(t.changedDuringRead);
        data.documents.push(...next.documents);
        data.requirements.push(...next.requirements);
        data.nextOffset = next.nextOffset;
      }
      if (!alive.current || request !== sequence.current) return;
      setSnapshot(data);
      setCompanies(list.companies);
      const [company, fit] = await Promise.all([
        companyId
          ? active.call<CompanyDetail>("company-detail", { id: companyId })
          : Promise.resolve(null),
        companyId && data.dossier?.value.corpusRevision
          ? active.call<Assessment | null>("assessment", {
              dossierId: processId,
              companyId,
            })
          : Promise.resolve(null),
      ]);
      if (!alive.current || request !== sequence.current) return;
      setDetail(company);
      setAssessment(fit);
    },
    [client, companyId, processId, t.invalidDossier, t.changedDuringRead],
  );
  useEffect(() => {
    setDetail(null);
    setAssessment(null);
    if (client)
      void refresh().catch((cause: unknown) => {
        if (alive.current && isMissingConnection(cause)) {
          setClient(null);
          setError("");
        } else if (alive.current) setError(t.loadError);
      });
  }, [client, refresh, t.loadError]);
  const activeJobs =
    Boolean(pendingJob) ||
    snapshot?.jobs.some((j) => j.state === "queued" || j.state === "running") ||
    detail?.jobs.some((j) => j.state === "queued" || j.state === "running");
  const cancellableJobs = Array.from(
    new Map(
      [pendingJob, ...(snapshot?.jobs ?? []), ...(detail?.jobs ?? [])]
        .filter(
          (job): job is Job =>
            job !== null && ["queued", "running"].includes(job.state),
        )
        .map((job) => [job.id, job]),
    ).values(),
  );
  const cancellableGroups = Array.from(
    cancellableJobs
      .reduce((groups, job) => {
        const key = job.kind ?? job.id;
        const list = groups.get(key) ?? [];
        list.push(job);
        groups.set(key, list);
        return groups;
      }, new Map<string, Job[]>())
      .entries(),
  ).map(([kind, jobs]) => ({ kind, jobs }));
  // Avoid contradiction: show the finished notice only once no active jobs
  // remain. If prepare finished while extracts are still queued, keep only
  // the in-progress indicator.
  const visibleNotice = activeJobs && notice === t.finishedJob ? "" : notice;
  useEffect(() => {
    if (!client || !activeJobs) return;
    const timer = setInterval(() => {
      if (pollLock.current) return;
      pollLock.current = true;
      void (async () => {
        if (pendingJob) {
          const job = await client.call<Job>("job", { id: pendingJob.id });
          if (!alive.current) return;
          if (["succeeded", "failed", "cancelled"].includes(job.state)) {
            setPendingJob(null);
            if (job.state === "failed")
              setError(`${t.failedJob}${job.error ?? "processing error"}.`);
            else setNotice(t.finishedJob);
          } else setPendingJob(job);
        }
        await refresh();
      })()
        .catch(() => {
          if (alive.current) setError(t.pollError);
        })
        .finally(() => {
          pollLock.current = false;
        });
    }, 4000);
    return () => clearInterval(timer);
  }, [
    activeJobs,
    client,
    pendingJob,
    refresh,
    t.failedJob,
    t.finishedJob,
    t.pollError,
  ]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : t.genericError);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function prepare() {
    if (!client) return;
    await run(async () => {
      const normalized = normalizeSecopRow({
        ...row,
        id: String(row.source_id ?? row.id),
      });
      if (!normalized) throw new Error(t.invalidTender);
      await saveInterest(savia, normalized);
      const result = await client.call<{ job: Job }>("prepare", {
        processId,
        idempotencyKey: crypto.randomUUID(),
      });
      setPendingJob(result.job);
      setNotice(t.savedInterest);
      await refresh();
    });
  }
  async function ticket(documentId?: string) {
    if (!client) return;
    await run(async () => {
      const result = await client.call<{ url: string }>(
        "upload-ticket",
        documentId ? { documentId } : { companyId },
      );
      const url = safeDossierUploadUrl(result.url);
      if (!url) throw new Error(t.invalidUpload);
      setUploadLink(url);
    });
  }
  async function openEvidence(documentId: string) {
    if (!client) return;
    await run(async () => {
      setEvidence(await client.call("citation", { documentId, offset: 0 }));
    });
  }
  async function reviewDocument(doc: Stored<DossierDocument>) {
    if (!client) return;
    await run(async () => {
      await client.call("review-document", {
        documentId: doc.id,
        expectedRevision: doc.revision,
        note: "User confirmed the extraction against the original source.",
      });
      await refresh();
    });
  }
  async function createCompany() {
    if (!client) return;
    await run(async () => {
      const profile = await client.call<Stored<Company>>("company", {
        expectedRevision: 0,
        profile: { name: companyName, legalId, activities, facts: [] },
      });
      setCompanyId(profile.id);
      setCompanyName("");
      setLegalId("");
      setActivities("");
      setNotice(t.companyCreated);
    });
  }
  async function evaluate() {
    if (!client || !detail || !snapshot?.dossier) return;
    await run(async () => {
      const result = await client.call<{ job: Job }>("assess", {
        dossierId: processId,
        companyId,
        companyRevision: detail.company.revision,
        corpusRevision: snapshot.dossier!.value.corpusRevision,
        selectedLots: [
          ...new Set(
            selectedLotsText
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ],
        idempotencyKey: crypto.randomUUID(),
      });
      setPendingJob(result.job);
    });
  }
  async function openAssistant(initialMessage?: string) {
    if (!client || !savia.assistant) {
      setError(t.assistantUpdate);
      return;
    }
    const assistantRequest = {
      title: `${processId} · ${String(row.name ?? t.headingFallback)}`.slice(
        0,
        160,
      ),
      actionId: "assistant-chat",
      connectionId: client.connectionId,
      taskCollection: "secop_application_tasks",
      context: {
        dossierId: processId,
        ...(companyId ? { companyProfileId: companyId } : {}),
      },
      ...(initialMessage ? { initialMessage } : {}),
    };
    await run(() => savia.assistant!.open(assistantRequest));
  }
  async function more() {
    if (!client || snapshot?.nextOffset == null) return;
    await run(async () => {
      const next = await client.call<DossierState>("dossier", {
        id: processId,
        offset: snapshot.nextOffset,
      });
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              documents: [
                ...previous.documents,
                ...next.documents.filter(
                  (d) => !previous.documents.some((x) => x.id === d.id),
                ),
              ],
              requirements: [
                ...previous.requirements,
                ...next.requirements.filter(
                  (r) => !previous.requirements.some((x) => x.id === r.id),
                ),
              ],
              nextOffset: next.nextOffset,
            }
          : next,
      );
    });
  }
  if (legacy)
    return (
      <TenderDocuments
        savia={savia}
        row={row}
        locale={locale}
        onBack={() => setLegacy(false)}
      />
    );
  const report = snapshot?.report?.value;
  const stale = Boolean(
    report &&
    snapshot?.dossier &&
    (report.corpusRevision !== snapshot.dossier.value.corpusRevision ||
      snapshot.dossier.value.needsSynthesis),
  );
  const selectedLots = [
    ...new Set(
      selectedLotsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].sort();
  const lotsMismatch = Boolean(
    assessment &&
    JSON.stringify([...(assessment.value.selectedLots ?? [])].sort()) !==
      JSON.stringify(selectedLots),
  );
  // Progress favors server-side coverage totals so paging through the
  // document list ("cargar más") never moves the percentage by itself.
  const guideCoverage =
    report && typeof report.coverage.total === "number"
      ? report.coverage
      : null;
  const guideTotal = guideCoverage?.total ?? snapshot?.documentTotal ?? 0;
  const guideReady = guideCoverage
    ? (guideCoverage.indexed ?? 0)
    : snapshot
      ? snapshot.documents.filter((doc) =>
          ["ready", "review_required", "analyzed"].includes(doc.value.state),
        ).length
      : 0;
  const guidePct =
    guideTotal > 0
      ? Math.min(100, Math.round((guideReady / guideTotal) * 100))
      : 0;
  const guideStage = !snapshot?.dossier
    ? 0
    : activeJobs || !report || stale
      ? 1
      : !companyId || !detail || !assessment || assessment.stale || lotsMismatch
        ? 2
        : 3;
  const documents = (docs: Stored<DossierDocument>[]) => (
    <ul className="secop-dossier-list">
      {docs.map((doc) => (
        <li key={doc.id}>
          <h3>{doc.value.name}</h3>
          <p className="secop-dossier-status">
            {dossierStateLabel(doc.value.state, locale)}
            {doc.value.error
              ? ` · ${dossierStateLabel(doc.value.error, locale)}`
              : ""}
          </p>
          <div className="secop-dossier-actions">
            <button
              type="button"
              className="secop-icon-action"
              aria-label={t.documentText}
              title={t.documentText}
              disabled={
                busy || !["ready", "review_required"].includes(doc.value.state)
              }
              onClick={() => void openEvidence(doc.id)}
            >
              <FileText size={16} aria-hidden="true" />
            </button>
            {doc.value.url && (
              <a
                href={doc.value.url}
                target="_blank"
                rel="noopener noreferrer"
                className="secop-icon-action"
                aria-label={t.officialFile}
                title={t.officialFile}
              >
                <ExternalLink size={16} aria-hidden="true" />
              </a>
            )}
            {["blocked", "failed"].includes(doc.value.state) && (
              <button
                type="button"
                className="secop-icon-action"
                aria-label={t.provideText}
                title={t.provideText}
                disabled={busy}
                onClick={() => void ticket(doc.id)}
              >
                <Upload size={16} aria-hidden="true" />
              </button>
            )}
            {doc.value.state === "review_required" && (
              <button
                type="button"
                className="secop-icon-action"
                aria-label={t.reviewedExtraction}
                title={t.reviewedExtraction}
                disabled={busy}
                onClick={() => void reviewDocument(doc)}
              >
                <Check size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <main className="secop-app secop-dossier" lang={locale}>
      <header className="secop-dossier-top">
        <div className="secop-dossier-toolbar">
          <button
            type="button"
            className="secop-icon-action"
            aria-label={t.back}
            title={t.back}
            onClick={onBack}
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
          <p className="secop-eyebrow">
            {t.eyebrow} · {processId}
          </p>
          {client && (
            <div className="secop-dossier-actions">
              <button
                type="button"
                disabled={busy || Boolean(activeJobs)}
                className="secop-primary secop-icon-action"
                aria-label={
                  snapshot?.dossier ? t.updateDossier : t.prepareDossier
                }
                title={snapshot?.dossier ? t.updateDossier : t.prepareDossier}
                onClick={() => void prepare()}
              >
                <FolderSync size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="secop-icon-action"
                aria-label={t.update}
                title={t.update}
                disabled={busy}
                onClick={() => void run(() => refresh())}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
        <h1>{String(row.name ?? t.headingFallback)}</h1>
        <p className="secop-dossier-help">{t.help}</p>
      </header>
      {initializing && (
        <div className="secop-loading-card" role="status">
          <div className="secop-loading-spinner" aria-hidden="true" />
          <div>
            <p>{t.checking}</p>
            <div className="secop-skeleton-lines" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="secop-dossier-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => refresh())}
          >
            {t.update}
          </button>
        </div>
      )}
      {visibleNotice && (
        <p className="secop-dossier-notice" role="status">
          {visibleNotice}
        </p>
      )}
      {!initializing && !client && (
        <section>
          <h2>{t.connectTitle}</h2>
          <p className="secop-dossier-help">{t.connectHelp}</p>
          <DossierForm
            onSubmit={() => {
              void run(async () => {
                await savia.connections.replace(DOSSIER_CONNECTOR, {
                  connectorId: DOSSIER_CONNECTOR,
                  values: { apiKey: token },
                });
                setToken("");
                setClient(new DossierClient(savia, DOSSIER_CONNECTOR));
              });
            }}
          >
            <label>
              {t.credential}
              <input
                type="password"
                autoComplete="off"
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <button disabled={busy} type="button" data-dossier-submit>
              {t.saveConnection}
            </button>
          </DossierForm>
          <button type="button" onClick={() => setLegacy(true)}>
            {t.legacy}
          </button>
        </section>
      )}
      {client && (
        <>
          <div className="secop-tabs" role="tablist" aria-label={t.tablist}>
            {tabs.map(([id, label, Icon]) => (
              <button
                key={id}
                id={`dossier-tab-${id}`}
                role="tab"
                type="button"
                tabIndex={tab === id ? 0 : -1}
                onKeyDown={(event) => {
                  const index = tabs.findIndex((t) => t[0] === id);
                  const direction =
                    event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowLeft"
                        ? -1
                        : 0;
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : direction
                          ? (index + direction + tabs.length) % tabs.length
                          : -1;
                  if (next >= 0) {
                    event.preventDefault();
                    selectTab(tabs[next][0]);
                    requestAnimationFrame(() =>
                      document
                        .getElementById(`dossier-tab-${tabs[next][0]}`)
                        ?.focus(),
                    );
                  }
                }}
                aria-selected={tab === id}
                aria-controls={`dossier-panel-${id}`}
                onClick={() => {
                  selectTab(id);
                  setEvidence(null);
                  setUploadLink(null);
                }}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          {activeJobs && (
            <div className="secop-dossier-working" role="status">
              <span className="secop-dossier-working-label">
                <RefreshCw size={16} aria-hidden="true" />
                <span>{t.working}</span>
              </span>
              <div className="secop-dossier-working-actions">
                {cancellableGroups.map(({ kind, jobs }) =>
                  jobs.length === 1 ? (
                    <button
                      key={jobs[0].id}
                      type="button"
                      className="secop-dossier-cancel"
                      aria-label={`${t.cancel} ${jobs[0].kind ?? jobs[0].id}`}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await client.call("cancel", { id: jobs[0].id });
                          if (pendingJob?.id === jobs[0].id)
                            setPendingJob(null);
                          await refresh();
                        })
                      }
                    >
                      {t.cancel}
                      {cancellableJobs.length > 1
                        ? ` · ${jobs[0].kind ?? jobs[0].id}`
                        : ""}
                    </button>
                  ) : (
                    <button
                      key={kind}
                      type="button"
                      className="secop-dossier-cancel"
                      aria-label={`${t.cancel} ${jobs.length} ${kind}`}
                      title={jobs.map((job) => job.id).join(", ")}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await Promise.all(
                            jobs.map((job) =>
                              client.call("cancel", { id: job.id }),
                            ),
                          );
                          if (
                            pendingJob &&
                            jobs.some((job) => job.id === pendingJob.id)
                          )
                            setPendingJob(null);
                          await refresh();
                        })
                      }
                    >
                      {t.cancel} {jobs.length} · {kind}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
          <section className="secop-guide" aria-label={t.guideNext}>
            <ol>
              {t.guideSteps.map((label, index) => (
                <li
                  key={label}
                  aria-current={guideStage === index ? "step" : undefined}
                  data-active={guideStage === index}
                  data-done={guideStage > index}
                >
                  <span aria-hidden="true">{index + 1}</span> {label}
                </li>
              ))}
            </ol>
            {snapshot?.dossier && guideTotal > 0 && (
              <div
                className="secop-guide-progress"
                role="status"
                aria-label={`${guideReady} de ${guideTotal} ${t.guideDocumentsReady}`}
              >
                <div aria-hidden="true">
                  <div style={{ width: `${guidePct}%` }} />
                </div>
                <p>
                  {guideReady} de {guideTotal} {t.guideDocumentsReady} ·{" "}
                  {guidePct}%
                </p>
              </div>
            )}
            <div className="secop-guide-next">
              <strong>{t.guideNext}</strong>
              {guideStage === 0 && (
                <>
                  <p>{t.guidePrepareHint}</p>
                  <button
                    type="button"
                    className="secop-primary"
                    disabled={busy || Boolean(activeJobs)}
                    onClick={() => void prepare()}
                  >
                    {t.prepareDossier}
                  </button>
                </>
              )}
              {guideStage === 1 && activeJobs && (
                <>
                  <p>
                    {guidePct >= 100
                      ? t.guideSynthesizingHint
                      : t.guideProcessingHint}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => refresh())}
                  >
                    {t.update}
                  </button>
                </>
              )}
              {guideStage === 1 && !activeJobs && (
                <>
                  <p>{t.guideReviewHint}</p>
                  <button
                    type="button"
                    className="secop-primary"
                    disabled={busy}
                    onClick={() => void prepare()}
                  >
                    {t.updateDossier}
                  </button>
                </>
              )}
              {guideStage === 2 && !companyId && (
                <>
                  <p>{t.guideCompanyHint}</p>
                  <button
                    type="button"
                    className="secop-primary"
                    onClick={() => selectTab("company")}
                  >
                    {t.guideGoCompany}
                  </button>
                </>
              )}
              {guideStage === 2 && Boolean(companyId) && (
                <>
                  <p>{t.guideEvaluateHint}</p>
                  <button
                    type="button"
                    className="secop-primary"
                    onClick={() => selectTab("company")}
                  >
                    {t.evaluate}
                  </button>
                </>
              )}
              {guideStage === 3 && (
                <>
                  <p>{t.guideChatHint}</p>
                  <button
                    type="button"
                    className="secop-primary"
                    onClick={() => selectTab("chat")}
                  >
                    {t.guideGoChat}
                  </button>
                </>
              )}
            </div>
          </section>
          {uploadLink && (
            <div className="secop-dossier-notice">
              <a href={uploadLink} target="_blank" rel="noopener noreferrer">
                {t.uploadLink} <ExternalLink size={14} aria-hidden="true" />
              </a>
              <p>{t.uploadHint}</p>
            </div>
          )}
          {evidence && (
            <aside
              className="secop-dossier-evidence"
              aria-label={t.evidenceLabel}
            >
              <div className="secop-dossier-actions">
                <h2>{evidence.document.value.name}</h2>
                <button type="button" onClick={() => setEvidence(null)}>
                  {t.closeEvidence}
                </button>
              </div>
              {evidence.chunks.map((chunk) => (
                <blockquote key={chunk.id}>
                  <strong>
                    {chunk.value.page
                      ? `${t.pageWord} ${chunk.value.page}`
                      : (chunk.value.section ?? t.section)}
                  </strong>
                  <p>{chunk.value.text}</p>
                </blockquote>
              ))}
              {evidence.nextOffset !== null && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const next = await client.call<typeof evidence>(
                        "citation",
                        {
                          documentId: evidence.document.id,
                          offset: evidence.nextOffset,
                        },
                      );
                      setEvidence({
                        ...next,
                        chunks: [...evidence.chunks, ...next.chunks],
                      });
                    })
                  }
                >
                  {t.moreText}
                </button>
              )}
            </aside>
          )}
          <section
            role="tabpanel"
            id={`dossier-panel-${tab}`}
            aria-labelledby={`dossier-tab-${tab}`}
          >
            {tab === "summary" && (
              <>
                {!snapshot?.dossier ? (
                  <div className="secop-dossier-notice">
                    <h2>{t.prepareHeading}</h2>
                    <p>{t.prepareHelp}</p>
                  </div>
                ) : (
                  <>
                    <dl className="secop-dossier-summary">
                      <div>
                        <dt>{t.jointAnalysis}</dt>
                        <dd>
                          {snapshot.dossier.value.needsSynthesis
                            ? t.pendingUpdate
                            : report
                              ? t.completed
                              : dossierStateLabel(
                                  snapshot.dossier.value.state,
                                  locale,
                                )}
                        </dd>
                      </div>
                      <div>
                        <dt>{t.catalogDocuments}</dt>
                        <dd>{snapshot.documentTotal}</dd>
                      </div>
                      <div>
                        <dt>{t.analyzedDocuments}</dt>
                        <dd>{report?.coverage.indexed ?? t.preparing}</dd>
                      </div>
                      <div>
                        <dt>{t.dossierVersion}</dt>
                        <dd>{snapshot.dossier.value.corpusRevision}</dd>
                      </div>
                    </dl>
                    <p className="secop-dossier-help">{t.coverage}</p>
                  </>
                )}
                {stale && (
                  <p className="secop-dossier-notice">{t.dossierChanged}</p>
                )}
                {report && (
                  <>
                    <div className="secop-dossier-section-heading">
                      <h2>{t.reportSummary}</h2>
                      <button type="button" onClick={() => selectTab("chat")}>
                        <ListChecks size={16} aria-hidden="true" /> {t.viewAll}
                      </button>
                    </div>
                    <div className="secop-dossier-text">{report.summary}</div>
                    {(report.coverage.pending.length > 0 ||
                      report.coverage.reviewRequired.length > 0) && (
                      <p className="secop-dossier-notice">
                        {t.pendingSources}
                        {report.coverage.pending.length}
                        {t.docsUnextracted}
                        {report.coverage.reviewRequired.length}
                        {t.extractionsReview}
                      </p>
                    )}
                    {report.conflicts.length > 0 && (
                      <>
                        <h2>{t.conflicts}</h2>
                        <ul>
                          {report.conflicts.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
                {snapshot?.jobs.some((job) => job.state === "failed") && (
                  <details className="secop-dossier-job-history">
                    <summary>{t.jobHistory}</summary>
                    {snapshot?.jobs
                      .filter((j) => j.state === "failed")
                      .map((job) => (
                        <div key={job.id} className="secop-dossier-notice">
                          <p>
                            {t.unresolvedJob}
                            {dossierStateLabel(
                              job.error ?? job.kind ?? "failed",
                              locale,
                            )}
                          </p>
                          <button
                            type="button"
                            className="secop-icon-action"
                            aria-label={t.retryJob}
                            title={t.retryJob}
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const next = await client.call<Job>("retry", {
                                  jobId: job.id,
                                });
                                setPendingJob(next);
                              })
                            }
                          >
                            <RefreshCw size={16} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                  </details>
                )}
              </>
            )}
            {tab === "documents" && (
              <>
                <div className="secop-dossier-section-heading secop-dossier-documents-heading">
                  <h2>{t.dossierDocuments}</h2>
                  <button
                    type="button"
                    className="secop-icon-action"
                    aria-label={t.legacyDocuments}
                    title={t.legacyDocuments}
                    onClick={() => setLegacy(true)}
                  >
                    <FolderOpen size={18} aria-hidden="true" />
                  </button>
                </div>
                {snapshot && snapshot.documents.length > 0 ? (
                  <>
                    <p className="secop-dossier-help">
                      {t.showing}
                      {snapshot.documents.length}
                      {t.of}
                      {snapshot.documentTotal}
                    </p>
                    {snapshot.documents.some(
                      (doc) => doc.value.state === "blocked",
                    ) && <p className="secop-dossier-help">{t.captchaHint}</p>}
                    {documents(snapshot.documents)}
                  </>
                ) : !initializing && !error ? (
                  <div className="secop-dossier-empty" role="status">
                    <FileText size={24} aria-hidden="true" />
                    <h3>{t.emptyDocuments}</h3>
                    <p>{t.emptyDocumentsHelp}</p>
                    <button
                      type="button"
                      className="secop-primary"
                      disabled={busy}
                      onClick={() => void prepare()}
                    >
                      {snapshot?.dossier ? t.updateDossier : t.prepareDossier}
                    </button>
                  </div>
                ) : null}
                {snapshot?.nextOffset !== null &&
                  snapshot?.nextOffset !== undefined && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void more()}
                    >
                      {t.moreDocuments}
                    </button>
                  )}
              </>
            )}
            {tab === "requirements" && (
              <>
                <h2>{t.sourcedRequirements}</h2>
                {!report && (
                  <div className="secop-dossier-empty" role="status">
                    <ListChecks size={24} aria-hidden="true" />
                    <p>{t.prepareForRequirements}</p>
                    <button
                      type="button"
                      className="secop-primary"
                      disabled={busy}
                      onClick={() => void prepare()}
                    >
                      {snapshot?.dossier ? t.updateDossier : t.prepareDossier}
                    </button>
                  </div>
                )}
                <ul className="secop-dossier-list">
                  {snapshot?.requirements.map((req) => (
                    <li key={req.id}>
                      <p className="secop-dossier-status">
                        {req.value.category} ·{" "}
                        {req.value.mandatory ? t.mandatory : t.informative}
                        {req.value.lot ? ` · ${t.lot} ${req.value.lot}` : ""}
                      </p>
                      <h3>{req.value.wording}</h3>
                      <CitationButtons
                        citations={req.value.citations}
                        onOpen={(id) => void openEvidence(id)}
                        locale={locale}
                      />
                    </li>
                  ))}
                </ul>
                {snapshot?.nextOffset !== null &&
                  snapshot?.nextOffset !== undefined && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void more()}
                    >
                      {t.moreRequirements}
                    </button>
                  )}
              </>
            )}
            {tab === "company" && (
              <>
                <h2>{t.evaluateCompany}</h2>
                <label>
                  {t.lotsToEvaluate}
                  <input
                    value={selectedLotsText}
                    onChange={(event) =>
                      setSelectedLotsText(event.target.value)
                    }
                    placeholder={t.lotPlaceholder}
                  />
                </label>
                <p className="secop-dossier-help">{t.lotHelp}</p>
                <label>
                  {t.company}
                  <select
                    value={companyId}
                    onChange={(event) => {
                      setCompanyId(event.target.value);
                      setUploadLink(null);
                    }}
                  >
                    <option value="">{t.selectCompany}</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.value.name}
                      </option>
                    ))}
                  </select>
                </label>
                <details>
                  <summary>{t.createCompany}</summary>
                  <DossierForm onSubmit={() => void createCompany()}>
                    <label>
                      {t.companyName}
                      <input
                        required
                        value={companyName}
                        onChange={(event) => setCompanyName(event.target.value)}
                      />
                    </label>
                    <label>
                      {t.taxId}
                      <input
                        value={legalId}
                        onChange={(event) => setLegalId(event.target.value)}
                      />
                    </label>
                    <label>
                      {t.activity}
                      <textarea
                        value={activities}
                        onChange={(event) => setActivities(event.target.value)}
                      />
                    </label>
                    <button type="button" data-dossier-submit disabled={busy}>
                      {t.createCompany}
                    </button>
                  </DossierForm>
                </details>
                {detail && (
                  <>
                    <div className="secop-dossier-actions">
                      <button
                        type="button"
                        className="secop-icon-action"
                        aria-label={t.addCompanyEvidence}
                        title={t.addCompanyEvidence}
                        disabled={busy}
                        onClick={() => void ticket()}
                      >
                        <Upload size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="secop-primary"
                        disabled={
                          busy || Boolean(activeJobs) || !report || stale
                        }
                        onClick={() => void evaluate()}
                      >
                        {t.evaluate}
                      </button>
                    </div>
                    <p className="secop-dossier-help">{t.companyHelp}</p>
                    {documents(detail.documents)}
                    {detail.company.value.facts.length > 0 && (
                      <>
                        <h2>{t.extractedFacts}</h2>
                        <p className="secop-dossier-help">{t.factsHelp}</p>
                        <ul className="secop-dossier-list">
                          {detail.company.value.facts.map((fact, index) => (
                            <li key={index}>
                              <strong>
                                {fact.field}: {fact.value} {fact.unit}
                                {fact.period ? ` · ${fact.period}` : ""}
                              </strong>
                              <CitationButtons
                                citations={fact.citations}
                                onOpen={(id) => void openEvidence(id)}
                                locale={locale}
                              />
                              {fact.reviewed ? (
                                <p>{t.reviewedFact}</p>
                              ) : (
                                <button
                                  type="button"
                                  className="secop-icon-action"
                                  aria-label={t.confirmFact}
                                  title={t.confirmFact}
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      await client.call("company-fact-review", {
                                        companyId,
                                        index,
                                        expectedRevision:
                                          detail.company.revision,
                                        note: "User checked the extracted figure against the cited original.",
                                      });
                                      await refresh();
                                    })
                                  }
                                >
                                  <Check size={16} aria-hidden="true" />
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {assessment && (
                      <>
                        <h2>
                          {dossierStateLabel(
                            lotsMismatch
                              ? "requires_review"
                              : assessment.readiness,
                            locale,
                          )}
                        </h2>
                        {(assessment.stale || lotsMismatch) && (
                          <p className="secop-dossier-notice">
                            {t.staleAssessment}
                          </p>
                        )}
                        {assessment.priorReviews?.length > 0 && (
                          <p>{t.priorReviews}</p>
                        )}
                        <ul className="secop-dossier-list">
                          {assessment.value.findings.map((finding) => (
                            <li key={finding.requirementId}>
                              <h3>
                                {dossierStateLabel(finding.status, locale)}
                              </h3>
                              <p>
                                {snapshot?.requirements.find(
                                  (r) => r.id === finding.requirementId,
                                )?.value.wording ?? finding.requirementId}
                              </p>
                              <p>{finding.reason}</p>
                              {finding.missing.length > 0 && (
                                <>
                                  <strong>{t.missingToApply}</strong>
                                  <ul>
                                    {finding.missing.map((missing, i) => (
                                      <li key={i}>{missing}</li>
                                    ))}
                                  </ul>
                                </>
                              )}
                              <CitationButtons
                                citations={finding.companyCitations}
                                onOpen={(id) => void openEvidence(id)}
                                locale={locale}
                              />
                              {assessment.reviews
                                .filter(
                                  (review) =>
                                    review.value.requirementId ===
                                    finding.requirementId,
                                )
                                .map((review) => (
                                  <p key={review.id}>
                                    <strong>{t.teamReview}</strong>{" "}
                                    {dossierStateLabel(
                                      review.value.decision,
                                      locale,
                                    )}{" "}
                                    · {review.value.note}
                                  </p>
                                ))}
                              <details>
                                <summary>{t.addTeamReview}</summary>
                                <DossierForm
                                  onSubmit={(form) => {
                                    const data = new FormData(form);
                                    void run(async () => {
                                      await client.call("review-finding", {
                                        assessmentId: assessment.id,
                                        requirementId: finding.requirementId,
                                        expectedRevision: assessment.revision,
                                        decision: String(data.get("decision")),
                                        note: String(data.get("note")),
                                      });
                                      await refresh();
                                    });
                                  }}
                                >
                                  <label>
                                    {t.decision}
                                    <select
                                      name="decision"
                                      defaultValue="insufficient_evidence"
                                    >
                                      <option value="insufficient_evidence">
                                        {t.insufficient}
                                      </option>
                                      <option value="meets">{t.meets}</option>
                                      <option value="does_not_meet">
                                        {t.doesNotMeet}
                                      </option>
                                      <option value="not_applicable">
                                        {t.notApplicable}
                                      </option>
                                    </select>
                                  </label>
                                  <label>
                                    {t.justification}
                                    <textarea
                                      name="note"
                                      required
                                      minLength={3}
                                      maxLength={2000}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    data-dossier-submit
                                    disabled={busy}
                                  >
                                    {t.saveReview}
                                  </button>
                                </DossierForm>
                              </details>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </>
            )}
            {tab === "chat" && (
              <div className="secop-dossier-assistant-entry">
                <div>
                  <MessageSquare size={24} aria-hidden="true" />
                  <h2>{t.assistantTitle}</h2>
                  <p className="secop-dossier-help">{t.assistantHelp}</p>
                </div>
                <label>
                  {t.companyForRequirements}
                  <select
                    value={companyId}
                    onChange={(event) => setCompanyId(event.target.value)}
                  >
                    <option value="">{t.tenderOnly}</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.value.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="secop-dossier-actions">
                  <button
                    type="button"
                    className="secop-primary secop-icon-action"
                    aria-label={t.openAssistant}
                    title={t.openAssistant}
                    disabled={busy || !report || !savia.assistant}
                    onClick={() => void openAssistant()}
                  >
                    <MessageSquare size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="secop-icon-action"
                    aria-label={t.prepareList}
                    title={t.prepareList}
                    disabled={busy || !report || !savia.assistant}
                    onClick={() =>
                      void openAssistant(
                        "Prepara la lista completa de todos los requisitos y documentos para aplicar a esta licitación, con evidencia por punto y todo lo que falta por verificar.",
                      )
                    }
                  >
                    <ListChecks size={16} aria-hidden="true" />
                  </button>
                </div>
                {!companyId && (
                  <p className="secop-dossier-help">{t.companyNotCompared}</p>
                )}
                {report &&
                  (report.coverage.pending.length > 0 ||
                    report.coverage.reviewRequired.length > 0) && (
                    <p className="secop-dossier-notice">
                      {report.coverage.pending.length > 0
                        ? `${report.coverage.pending.length}${t.pendingDocs}`
                        : t.extractedAll}
                      {report.coverage.reviewRequired.length}
                      {t.needsReview}
                    </p>
                  )}
                {!report && (
                  <p className="secop-dossier-help">{t.prepareBeforeChat}</p>
                )}
                {!savia.assistant && (
                  <p role="status" className="secop-dossier-notice">
                    {t.assistantUnavailable}
                  </p>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
