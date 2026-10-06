/** Display captions for request execution states; persisted state values stay unchanged. */
export const integrationMessages = {
  running: ["En proceso", "In progress", "Em andamento"],
  complete: ["Completada", "Completed", "Concluída"],
  failed: ["No se completó", "Not completed", "Não concluído"],
} as const;

/** Personal integrations (connections) and virtual AI employees UI copy. Keys are the Spanish source. */
export const personalIntegrationsMessages = {
  Colaboración: ["Colaboración", "Collaboration", "Colaboração"],
  "Un administrador debe habilitar %{provider} en Nango. Después podrás conectar tu cuenta aquí.":
    [
      "Un administrador debe habilitar %{provider} en Nango. Después podrás conectar tu cuenta aquí.",
      "An administrator must enable %{provider} in Nango. Then you can connect your account here.",
      "Um administrador precisa habilitar %{provider} no Nango. Depois você poderá conectar sua conta aqui.",
    ],
  "Comparte resúmenes de registros en canales de Slack.": [
    "Comparte resúmenes de registros en canales de Slack.",
    "Share record summaries in Slack channels.",
    "Compartilhe resumos de registros nos canais do Slack.",
  ],
  "Comparte resúmenes de registros en canales de Microsoft Teams.": [
    "Comparte resúmenes de registros en canales de Microsoft Teams.",
    "Share record summaries in Microsoft Teams channels.",
    "Compartilhe resumos de registros nos canais do Microsoft Teams.",
  ],
  Aplicaciones: ["Aplicaciones", "Apps", "Aplicativos"],
  Integraciones: ["Integraciones", "Integrations", "Integrações"],
  "Ayuda sobre %{v1}": [
    "Ayuda sobre %{v1}",
    "Help with %{v1}",
    "Ajuda sobre %{v1}",
  ],
  "Conecta tus cuentas, servicios y configura los empleados virtuales de IA para Savia.":
    [
      "Conecta tus cuentas, servicios y configura los empleados virtuales de IA para Savia.",
      "Connect your accounts, services, and configure AI virtual employees for Savia.",
      "Conecte suas contas, serviços e configure os funcionários virtuais de IA para o Savia.",
    ],
  "Cuentas y Conexiones": [
    "Cuentas y Conexiones",
    "Accounts & Connections",
    "Contas e Conexões",
  ],
  "Empleados Virtuales (IA)": [
    "Empleados Virtuales (IA)",
    "Virtual Employees (AI)",
    "Funcionários Virtuais (IA)",
  ],
  CRM: ["CRM", "CRM", "CRM"],
  "Gestión de incidencias": [
    "Gestión de incidencias",
    "Issue tracking",
    "Rastreamento de issues",
  ],
  "Un administrador debe habilitar Jira en Nango. Después podrás conectar tu cuenta aquí.":
    [
      "Un administrador debe habilitar Jira en Nango. Después podrás conectar tu cuenta aquí.",
      "An administrator must enable Jira in Nango. Then you can connect your account here.",
      "Um administrador precisa habilitar o Jira no Nango. Depois você poderá conectar sua conta aqui.",
    ],
  "Un administrador debe habilitar Linear en Nango. Después podrás conectar tu cuenta aquí.":
    [
      "Un administrador debe habilitar Linear en Nango. Después podrás conectar tu cuenta aquí.",
      "An administrator must enable Linear in Nango. Then you can connect your account here.",
      "Um administrador precisa habilitar o Linear no Nango. Depois você poderá conectar sua conta aqui.",
    ],
  "Un administrador debe habilitar GitHub en Nango. Después podrás conectar tu cuenta aquí.":
    [
      "Un administrador debe habilitar GitHub en Nango. Después podrás conectar tu cuenta aquí.",
      "An administrator must enable GitHub in Nango. Then you can connect your account here.",
      "Um administrador precisa habilitar o GitHub no Nango. Depois você poderá conectar sua conta aqui.",
    ],
  "Conecta Jira Cloud para previsualizar incidencias en Páginas.": [
    "Conecta Jira Cloud para previsualizar incidencias en Páginas.",
    "Connect Jira Cloud to preview issues in Pages.",
    "Conecte o Jira Cloud para visualizar issues nas Páginas.",
  ],
  "Conecta Linear para previsualizar incidencias en Páginas.": [
    "Conecta Linear para previsualizar incidencias en Páginas.",
    "Connect Linear to preview issues in Pages.",
    "Conecte o Linear para visualizar issues nas Páginas.",
  ],
  "Conecta GitHub para previsualizar incidencias y pull requests en Páginas.": [
    "Conecta GitHub para previsualizar incidencias y pull requests en Páginas.",
    "Connect GitHub to preview issues and pull requests in Pages.",
    "Conecte o GitHub para visualizar issues e pull requests nas Páginas.",
  ],
  "Ver configuración": ["Ver configuración", "View setup", "Ver configuração"],
  "Registra cada proveedor como una integración de Nango con permisos de solo lectura. Configura estas variables en el servidor y reinicia Savia:":
    [
      "Registra cada proveedor como una integración de Nango con permisos de solo lectura. Configura estas variables en el servidor y reinicia Savia:",
      "Register each provider as a Nango integration with read-only access. Set these server variables and restart Savia:",
      "Registre cada provedor como uma integração do Nango com acesso somente de leitura. Configure estas variáveis no servidor e reinicie o Savia:",
    ],
  "Requiere configuración": [
    "Requiere configuración",
    "Setup required",
    "Configuração necessária",
  ],
  "No pudimos cargar el estado de las integraciones.": [
    "No pudimos cargar el estado de las integraciones.",
    "We couldn't load the integrations status.",
    "Não foi possível carregar o status das integrações.",
  ],
  "La API que está en ejecución aún no incluye las integraciones personales. Reinicia Savia desde la versión actual.":
    [
      "La API que está en ejecución aún no incluye las integraciones personales. Reinicia Savia desde la versión actual.",
      "The running API does not include personal integrations yet. Restart Savia from the current version.",
      "A API em execução ainda não inclui integrações pessoais. Reinicie o Savia a partir da versão atual.",
    ],
  "Conectado como %{label}.": [
    "Conectado como %{label}.",
    "Connected as %{label}.",
    "Conectado como %{label}.",
  ],
  "Conexión autorizada y lista para usarse.": [
    "Conexión autorizada y lista para usarse.",
    "Connection authorized and ready to use.",
    "Conexão autorizada e pronta para uso.",
  ],
  "La sesión expiró. Vuelve a conectar para continuar usándola.": [
    "La sesión expiró. Vuelve a conectar para continuar usándola.",
    "The session expired. Reconnect to keep using it.",
    "A sessão expirou. Reconecte para continuar usando.",
  ],
  "La última sincronización falló. Intenta reconectar la cuenta.": [
    "La última sincronización falló. Intenta reconectar la cuenta.",
    "The last sync failed. Try reconnecting the account.",
    "A última sincronização falhou. Tente reconectar a conta.",
  ],
  "Finalizando la autorización en segundo plano…": [
    "Finalizando la autorización en segundo plano…",
    "Finishing authorization in the background…",
    "Finalizando a autorização em segundo plano…",
  ],
  "Requiere tu autorización antes de que Savia pueda interactuar con ella.": [
    "Requiere tu autorización antes de que Savia pueda interactuar con ella.",
    "It requires your authorization before Savia can interact with it.",
    "Requer sua autorização antes que o Savia possa interagir com ela.",
  ],
  Conectada: ["Conectada", "Connected", "Conectada"],
  Reconectar: ["Reconectar", "Reconnect", "Reconectar"],
  Falló: ["Falló", "Failed", "Falhou"],
  Pendiente: ["Pendiente", "Pending", "Pendente"],
  Desconectada: ["Desconectada", "Disconnected", "Desconectada"],
  "No disponible": ["No disponible", "Unavailable", "Indisponível"],
  Desconectar: ["Desconectar", "Disconnect", "Desconectar"],
  Reintentar: ["Reintentar", "Retry", "Tentar novamente"],
  Conectar: ["Conectar", "Connect", "Conectar"],
  "Ocurrió un error inesperado al gestionar la integración.": [
    "Ocurrió un error inesperado al gestionar la integración.",
    "An unexpected error occurred while managing the integration.",
    "Ocorreu um erro inesperado ao gerenciar a integração.",
  ],
  "La cuenta quedó conectada de forma segura.": [
    "La cuenta quedó conectada de forma segura.",
    "The account was connected securely.",
    "A conta foi conectada com segurança.",
  ],
  "La cuenta quedó desconectada.": [
    "La cuenta quedó desconectada.",
    "The account was disconnected.",
    "A conta foi desconectada.",
  ],
  "Nango no informó una conexión válida.": [
    "Nango no informó una conexión válida.",
    "Nango did not report a valid connection.",
    "O Nango não informou uma conexão válida.",
  ],
  "La ventana de conexión se cerró sin cambios.": [
    "La ventana de conexión se cerró sin cambios.",
    "The connection window was closed without changes.",
    "A janela de conexão foi fechada sem alterações.",
  ],
  "No fue posible completar la autorización de la cuenta.": [
    "No fue posible completar la autorización de la cuenta.",
    "The account authorization could not be completed.",
    "Não foi possível concluir a autorização da conta.",
  ],
  "No hay integraciones disponibles.": [
    "No hay integraciones disponibles.",
    "No integrations available.",
    "Nenhuma integração disponível.",
  ],
  "WhatsApp no está disponible en este entorno.": [
    "WhatsApp no está disponible en este entorno.",
    "WhatsApp is not available in this environment.",
    "O WhatsApp não está disponível neste ambiente.",
  ],
  "Logo de %{value}": [
    "Logo de %{value}",
    "Logo of %{value}",
    "Logo de %{value}",
  ],
  "Cargando integraciones…": [
    "Cargando integraciones…",
    "Loading integrations…",
    "Carregando integrações…",
  ],
  "Empleados Virtuales de IA": [
    "Empleados Virtuales de IA",
    "AI Virtual Employees",
    "Funcionários Virtuais de IA",
  ],
  "Digital colleagues que puedes invocar usando": [
    "Digital colleagues que puedes invocar usando",
    "Digital colleagues you can invoke using",
    "Colegas digitais que você pode invocar usando",
  ],
  "en el chat, con acceso scoped a colecciones y base de conocimiento Cloudflare RAG.":
    [
      "en el chat, en modo de solo texto o con acceso limitado a las colecciones y documentos que autorices.",
      "in chat, in text-only mode or with scoped access to collections and documents you authorize.",
      "no chat, no modo somente texto ou com acesso limitado às coleções e aos documentos que você autorizar.",
    ],
  "Nuevo Empleado": ["Nuevo Empleado", "New Employee", "Novo Funcionário"],
  "Buscar empleado por nombre o @handle...": [
    "Buscar empleado por nombre o @handle...",
    "Search employees by name or @handle...",
    "Buscar funcionário por nome ou @handle...",
  ],
  "%{count} empleados": [
    "%{count} empleados",
    "%{count} employees",
    "%{count} funcionários",
  ],
  "No hay empleados virtuales": [
    "No hay empleados virtuales",
    "No virtual employees",
    "Nenhum funcionário virtual",
  ],
  "Crea tu primer empleado virtual asignándole un rol, colecciones permitidas y documentos para potenciar tu equipo.":
    [
      "Crea tu primer empleado virtual con instrucciones de solo texto o acceso limitado a datos y documentos de trabajo.",
      "Create your first virtual employee with text-only instructions or scoped access to workspace data and documents.",
      "Crie seu primeiro funcionário virtual com instruções somente de texto ou acesso limitado aos dados e documentos de trabalho.",
    ],
  "Crear Empleado": ["Crear Empleado", "Create Employee", "Criar Funcionário"],
  Activo: ["Activo", "Active", "Ativo"],
  Inactivo: ["Inactivo", "Inactive", "Inativo"],
  "Todas las colecciones": [
    "Todas las colecciones",
    "All collections",
    "Todas as coleções",
  ],
  "%{count} colecciones": [
    "%{count} colecciones",
    "%{count} collections",
    "%{count} coleções",
  ],
  "%{count} docs RAG": [
    "%{count} docs RAG",
    "%{count} RAG docs",
    "%{count} docs RAG",
  ],
  Editar: ["Editar", "Edit", "Editar"],
  "Editar Empleado Virtual: @%{handle}": [
    "Editar Empleado Virtual: @%{handle}",
    "Edit Virtual Employee: @%{handle}",
    "Editar Funcionário Virtual: @%{handle}",
  ],
  "Nuevo Empleado Virtual de IA": [
    "Nuevo Empleado Virtual de IA",
    "New AI Virtual Employee",
    "Novo Funcionário Virtual de IA",
  ],
  "Plantilla: Traductor español → inglés": [
    "Plantilla: Traductor español → inglés",
    "Template: Spanish → English translator",
    "Modelo: Tradutor espanhol → inglês",
  ],
  "Modo del empleado": [
    "Modo del empleado",
    "Employee mode",
    "Modo do funcionário",
  ],
  "Solo texto": ["Solo texto", "Text only", "Somente texto"],
  "Workspace tools": [
    "Herramientas del espacio de trabajo",
    "Workspace tools",
    "Ferramentas do espaço de trabalho",
  ],
  "Elige si el empleado usará solo el texto que recibe o también las herramientas y los datos de trabajo que autorices.":
    [
      "Elige si el empleado usará solo el texto que recibe o también las herramientas y los datos de trabajo que autorices.",
      "Choose whether the employee uses only supplied text or also the workspace tools and data you authorize.",
      "Escolha se o funcionário usará somente o texto fornecido ou também as ferramentas e os dados de trabalho que você autorizar.",
    ],
  "Solo se procesa el texto y las instrucciones proporcionadas. No se usan colecciones, documentos ni herramientas del espacio de trabajo.":
    [
      "Solo se procesa el texto y las instrucciones proporcionadas. No se usan colecciones, documentos ni herramientas del espacio de trabajo.",
      "Only the supplied text and instructions are processed. Workspace collections, documents, and tools are not used.",
      "Somente o texto e as instruções fornecidos são processados. Coleções, documentos e ferramentas do espaço de trabalho não são usados.",
    ],
  "El empleado puede usar las colecciones y los documentos que autorices en las pestañas de acceso del espacio de trabajo.":
    [
      "El empleado puede usar las colecciones y los documentos que autorices en las pestañas de acceso del espacio de trabajo.",
      "The employee can use the collections and documents you authorize in the workspace access tabs.",
      "O funcionário pode usar as coleções e os documentos que você autorizar nas abas de acesso do espaço de trabalho.",
    ],
  "Elige al menos una colección o activa el acceso a todas las colecciones para usar Workspace tools.":
    [
      "Elige al menos una colección o activa el acceso a todas las colecciones para usar Workspace tools.",
      "Choose at least one collection or enable all-collection access to use Workspace tools.",
      "Escolha pelo menos uma coleção ou habilite o acesso a todas as coleções para usar as ferramentas do espaço de trabalho.",
    ],
  Perfil: ["Perfil", "Profile", "Perfil"],
  "Rol & Prompt": ["Rol & Prompt", "Role & Prompt", "Função e Prompt"],
  Colecciones: ["Colecciones", "Collections", "Coleções"],
  "Base RAG": ["Base RAG", "RAG Base", "Base RAG"],
  Modelo: ["Modelo", "Model", "Modelo"],
  "Nombre Visible": ["Nombre Visible", "Display Name", "Nome Visível"],
  "Ej. Laura - Ventas": [
    "Ej. Laura - Ventas",
    "E.g. Laura - Sales",
    "Ex.: Laura - Vendas",
  ],
  "Identificador para Mención (@handle)": [
    "Identificador para Mención (@handle)",
    "Mention Identifier (@handle)",
    "Identificador para Menção (@handle)",
  ],
  ventas: ["ventas", "sales", "vendas"],
  "Cargo o Rol de Negocio": [
    "Cargo o Rol de Negocio",
    "Job Title or Business Role",
    "Cargo ou Função de Negócio",
  ],
  "Ej. Asesora Comercial y Especialista en Cotizaciones": [
    "Ej. Asesora Comercial y Especialista en Cotizaciones",
    "E.g. Sales Advisor and Quoting Specialist",
    "Ex.: Consultora Comercial e Especialista em Cotações",
  ],
  "Avatar / Icono Representativo": [
    "Avatar / Icono Representativo",
    "Avatar / Representative Icon",
    "Avatar / Ícone Representativo",
  ],
  "Mensaje de Saludo (Greeting)": [
    "Mensaje de Saludo (Greeting)",
    "Greeting Message",
    "Mensagem de Saudação (Greeting)",
  ],
  "Ej. ¡Hola! Soy Laura. ¿Qué oportunidad o cotización deseas revisar hoy?": [
    "Ej. ¡Hola! Soy Laura. ¿Qué oportunidad o cotización deseas revisar hoy?",
    "E.g. Hi! I'm Laura. Which opportunity or quote would you like to review today?",
    "Ex.: Olá! Sou a Laura. Qual oportunidade ou cotação você deseja revisar hoje?",
  ],
  "Estado del Empleado": [
    "Estado del Empleado",
    "Employee Status",
    "Status do Funcionário",
  ],
  "Los empleados inactivos no pueden ser invocados con @ en el chat.": [
    "Los empleados inactivos no pueden ser invocados con @ en el chat.",
    "Inactive employees cannot be invoked with @ in chat.",
    "Funcionários inativos não podem ser invocados com @ no chat.",
  ],
  "Instrucciones de Rol (System Prompt)": [
    "Instrucciones de Rol (System Prompt)",
    "Role Instructions (System Prompt)",
    "Instruções de Função (System Prompt)",
  ],
  "Define identidad, límites y tono de respuesta": [
    "Define identidad, límites y tono de respuesta",
    "Define identity, boundaries, and response tone",
    "Defina identidade, limites e tom de resposta",
  ],
  "Ejemplo de prompt de ventas": [
    "Ejemplo de prompt de ventas",
    "Sales prompt example",
    "Exemplo de prompt de vendas",
  ],
  "Tip: delimita claramente el ámbito del empleado para que no responda sobre áreas ajenas a su especialidad.":
    [
      "Tip: delimita claramente el ámbito del empleado para que no responda sobre áreas ajenas a su especialidad.",
      "Tip: clearly delimit the employee's scope so it doesn't answer outside its specialty.",
      "Dica: delimite claramente o escopo do funcionário para que ele não responda fora de sua especialidade.",
    ],
  "Acceso a Todas las Colecciones de Studio": [
    "Acceso a Todas las Colecciones de Studio",
    "Access to All Studio Collections",
    "Acesso a Todas as Coleções do Studio",
  ],
  "Si está activo, el empleado puede consultar cualquier colección de Studio sin restricciones.":
    [
      "Si está activo, el empleado puede consultar cualquier colección de Studio sin restricciones.",
      "When enabled, the employee can query any Studio collection without restrictions.",
      "Quando ativo, o funcionário pode consultar qualquer coleção do Studio sem restrições.",
    ],
  "Colecciones Permitidas (Acceso Scoped)": [
    "Colecciones Permitidas (Acceso Scoped)",
    "Allowed Collections (Scoped Access)",
    "Coleções Permitidas (Acesso com Escopo)",
  ],
  "%{count} seleccionadas": [
    "%{count} seleccionadas",
    "%{count} selected",
    "%{count} selecionadas",
  ],
  "Seleccionar visibles": [
    "Seleccionar visibles",
    "Select visible",
    "Selecionar visíveis",
  ],
  "Limpiar selección": [
    "Limpiar selección",
    "Clear selection",
    "Limpar seleção",
  ],
  "Buscar por nombre o identificador (ej. Empresas, Contactos, cotizaciones)...":
    [
      "Buscar por nombre o identificador (ej. Empresas, Contactos, cotizaciones)...",
      "Search by name or identifier (e.g. Companies, Contacts, quotes)...",
      "Buscar por nome ou identificador (ex.: Empresas, Contatos, cotações)...",
    ],
  "Cargando colecciones del sistema...": [
    "Cargando colecciones del sistema...",
    "Loading system collections...",
    "Carregando coleções do sistema...",
  ],
  'No se encontraron colecciones que coincidan con "%{query}".': [
    'No se encontraron colecciones que coincidan con "%{query}".',
    'No collections found matching "%{query}".',
    'Nenhuma coleção encontrada para "%{query}".',
  ],
  "No hay colecciones disponibles en este tenant. Puedes añadir una abajo.": [
    "No hay colecciones disponibles en este tenant. Puedes añadir una abajo.",
    "No collections available in this tenant. You can add one below.",
    "Nenhuma coleção disponível neste tenant. Você pode adicionar uma abaixo.",
  ],
  "Añadir colección personalizada:": [
    "Añadir colección personalizada:",
    "Add custom collection:",
    "Adicionar coleção personalizada:",
  ],
  nombre_coleccion: ["nombre_coleccion", "collection_name", "nome_colecao"],
  Añadir: ["Añadir", "Add", "Adicionar"],
  "Colecciones seleccionadas (%{count}):": [
    "Colecciones seleccionadas (%{count}):",
    "Selected collections (%{count}):",
    "Coleções selecionadas (%{count}):",
  ],
  Quitar: ["Quitar", "Remove", "Remover"],
  Eliminar: ["Eliminar", "Delete", "Excluir"],
  "Documentos de Referencia (Cloudflare RAG)": [
    "Documentos de Referencia (Cloudflare RAG)",
    "Reference Documents (Cloudflare RAG)",
    "Documentos de Referência (Cloudflare RAG)",
  ],
  "Sube manuales, políticas, tarifas o catálogos (PDF, MD, TXT, CSV, JSON). El motor RAG de Cloudflare generará embeddings para recuperar contexto relevante.":
    [
      "Sube manuales, políticas, tarifas o catálogos (PDF, MD, TXT, CSV, JSON). El motor RAG de Cloudflare generará embeddings para recuperar contexto relevante.",
      "Upload manuals, policies, rates, or catalogs (PDF, MD, TXT, CSV, JSON). The Cloudflare RAG engine will generate embeddings to retrieve relevant context.",
      "Envie manuais, políticas, tarifas ou catálogos (PDF, MD, TXT, CSV, JSON). O mecanismo RAG da Cloudflare gerará embeddings para recuperar contexto relevante.",
    ],
  "Guarda el empleado primero para habilitar la carga de documentos RAG.": [
    "Guarda el empleado primero para habilitar la carga de documentos RAG.",
    "Save the employee first to enable RAG document uploads.",
    "Salve o funcionário primeiro para habilitar o envio de documentos RAG.",
  ],
  "Indexando RAG...": [
    "Indexando RAG...",
    "Indexing RAG...",
    "Indexando RAG...",
  ],
  "Subir Documento": ["Subir Documento", "Upload Document", "Enviar Documento"],
  "Formatos: PDF, Markdown, Texto, CSV, JSON (hasta 10 MB)": [
    "Formatos: PDF, Markdown, Texto, CSV, JSON (hasta 10 MB)",
    "Formats: PDF, Markdown, Text, CSV, JSON (up to 10 MB)",
    "Formatos: PDF, Markdown, Texto, CSV, JSON (até 10 MB)",
  ],
  "No hay documentos cargados para este empleado virtual.": [
    "No hay documentos cargados para este empleado virtual.",
    "No documents uploaded for this virtual employee.",
    "Nenhum documento enviado para este funcionário virtual.",
  ],
  "Indexado RAG": ["Indexado RAG", "RAG Indexed", "Indexado RAG"],
  Procesando: ["Procesando", "Processing", "Processando"],
  Error: ["Error", "Error", "Erro"],
  "Modelo LLM Específico (Opcional)": [
    "Modelo LLM Específico (Opcional)",
    "Specific LLM Model (Optional)",
    "Modelo LLM Específico (Opcional)",
  ],
  "Hereda de la organización o global": [
    "Hereda de la organización o global",
    "Inherits from organization or global",
    "Herda da organização ou global",
  ],
  "Hereda de la agencia o global": [
    "Hereda de la agencia o global",
    "Inherits from agency or global",
    "Herda da agência ou global",
  ],
  "Si especificas un modelo aquí, este empleado utilizará este modelo cuando sea invocado en el chat. Sus capacidades se activarán automáticamente.":
    [
      "Si especificas un modelo aquí, este empleado utilizará este modelo cuando sea invocado en el chat. Sus capacidades se activarán automáticamente.",
      "If you specify a model here, this employee will use it when invoked in chat. Its capabilities will be enabled automatically.",
      "Se você especificar um modelo aqui, este funcionário o utilizará quando invocado no chat. Suas capacidades serão ativadas automaticamente.",
    ],
  Cancelar: ["Cancelar", "Cancel", "Cancelar"],
  "Guardando...": ["Guardando...", "Saving...", "Salvando..."],
  "Guardar Cambios": ["Guardar Cambios", "Save Changes", "Salvar Alterações"],
  "Error al cargar empleados virtuales": [
    "Error al cargar empleados virtuales",
    "Error loading virtual employees",
    "Erro ao carregar funcionários virtuais",
  ],
  "El nombre del empleado es obligatorio": [
    "El nombre del empleado es obligatorio",
    "Employee name is required",
    "O nome do funcionário é obrigatório",
  ],
  "El handle (@mención) es obligatorio": [
    "El handle (@mención) es obligatorio",
    "Handle (@mention) is required",
    "O handle (@menção) é obrigatório",
  ],
  "El rol / instrucciones del sistema son obligatorios": [
    "El rol / instrucciones del sistema son obligatorios",
    "Role / system instructions are required",
    "A função / instruções do sistema são obrigatórias",
  ],
  "Empleado virtual actualizado con éxito": [
    "Empleado virtual actualizado con éxito",
    "Virtual employee updated successfully",
    "Funcionário virtual atualizado com sucesso",
  ],
  "Empleado virtual creado con éxito": [
    "Empleado virtual creado con éxito",
    "Virtual employee created successfully",
    "Funcionário virtual criado com sucesso",
  ],
  "Error al guardar empleado virtual": [
    "Error al guardar empleado virtual",
    "Error saving virtual employee",
    "Erro ao salvar funcionário virtual",
  ],
  "¿Eliminar al empleado virtual @%{handle} (%{name})?": [
    "¿Eliminar al empleado virtual @%{handle} (%{name})?",
    "Delete virtual employee @%{handle} (%{name})?",
    "Excluir o funcionário virtual @%{handle} (%{name})?",
  ],
  "Empleado virtual eliminado": [
    "Empleado virtual eliminado",
    "Virtual employee deleted",
    "Funcionário virtual excluído",
  ],
  "Error al eliminar empleado": [
    "Error al eliminar empleado",
    "Error deleting employee",
    "Erro ao excluir funcionário",
  ],
  "Archivo indexado en Cloudflare RAG (%{name})": [
    "Archivo indexado en Cloudflare RAG (%{name})",
    "File indexed in Cloudflare RAG (%{name})",
    "Arquivo indexado no Cloudflare RAG (%{name})",
  ],
  "Error al subir archivo": [
    "Error al subir archivo",
    "Error uploading file",
    "Erro ao enviar arquivo",
  ],
  "Archivo y vectores RAG eliminados": [
    "Archivo y vectores RAG eliminados",
    "File and RAG vectors deleted",
    "Arquivo e vetores RAG excluídos",
  ],
  "Error al eliminar archivo": [
    "Error al eliminar archivo",
    "Error deleting file",
    "Erro ao excluir arquivo",
  ],
  "ChatGPT y Claude": ["ChatGPT y Claude", "ChatGPT and Claude", "ChatGPT e Claude"],
  "Conecta Savia con ChatGPT y Claude para consultar tus colecciones y pedir tareas a tus empleados virtuales desde esos asistentes.":
    [
      "Conecta Savia con ChatGPT y Claude para consultar tus colecciones y pedir tareas a tus empleados virtuales desde esos asistentes.",
      "Connect Savia with ChatGPT and Claude to query your collections and ask your virtual employees for tasks from those assistants.",
      "Conecte o Savia ao ChatGPT e ao Claude para consultar suas coleções e pedir tarefas aos seus funcionários virtuais a partir desses assistentes.",
    ],
  "URL de conexión (MCP)": [
    "URL de conexión (MCP)",
    "Connection URL (MCP)",
    "URL de conexão (MCP)",
  ],
  "Copia esta URL en el conector personalizado de ChatGPT o Claude. Siempre termina en /mcp y usa OAuth, sin pegar secretos internos.":
    [
      "Copia esta URL en el conector personalizado de ChatGPT o Claude. Siempre termina en /mcp y usa OAuth, sin pegar secretos internos.",
      "Paste this URL into the ChatGPT or Claude custom connector. It always ends in /mcp and uses OAuth, without pasting internal secrets.",
      "Cole esta URL no conector personalizado do ChatGPT ou do Claude. Ela sempre termina em /mcp e usa OAuth, sem colar segredos internos.",
    ],
  "Copiar URL": ["Copiar URL", "Copy URL", "Copiar URL"],
  "URL copiada": ["URL copiada", "URL copied", "URL copiada"],
  "¿Qué necesitas antes de empezar?": [
    "¿Qué necesitas antes de empezar?",
    "What do you need before starting?",
    "Do que você precisa antes de começar?",
  ],
  "Acceso a ChatGPT con modo Desarrollador o a Claude con conectores personalizados habilitados.":
    [
      "Acceso a ChatGPT con modo Desarrollador o a Claude con conectores personalizados habilitados.",
      "Access to ChatGPT with Developer mode or to Claude with custom connectors enabled.",
      "Acesso ao ChatGPT com modo Desenvolvedor ou ao Claude com conectores personalizados habilitados.",
    ],
  "Tu usuario de Savia con acceso a la organización que quieres consultar.": [
    "Tu usuario de Savia con acceso a la organización que quieres consultar.",
    "Your Savia user with access to the organization you want to query.",
    "Seu usuário do Savia com acesso à organização que você deseja consultar.",
  ],
  "Conexión HTTPS al entorno desplegado. Los clientes en la nube no pueden alcanzar localhost.":
    [
      "Conexión HTTPS al entorno desplegado. Los clientes en la nube no pueden alcanzar localhost.",
      "HTTPS connection to the deployed environment. Cloud clients cannot reach localhost.",
      "Conexão HTTPS com o ambiente implantado. Clientes na nuvem não conseguem alcançar localhost.",
    ],
  "Cómo conectar ChatGPT": [
    "Cómo conectar ChatGPT",
    "How to connect ChatGPT",
    "Como conectar o ChatGPT",
  ],
  "Cómo conectar Claude": [
    "Cómo conectar Claude",
    "How to connect Claude",
    "Como conectar o Claude",
  ],
  "Activa el modo Desarrollador en Ajustes → Seguridad e inicio de sesión → Seguridad avanzada.":
    [
      "Activa el modo Desarrollador en Ajustes → Seguridad e inicio de sesión → Seguridad avanzada.",
      "Enable Developer mode in Settings → Security and login → Advanced security.",
      "Ative o modo Desenvolvedor em Ajustes → Segurança e login → Segurança avançada.",
    ],
  "Abre Plugins, pulsa Crear app (+) e introduce el nombre de Savia y la URL de conexión.":
    [
      "Abre Plugins, pulsa Crear app (+) e introduce el nombre de Savia y la URL de conexión.",
      "Open Plugins, click Create app (+) and enter the Savia name and the connection URL.",
      "Abra Plugins, clique em Criar app (+) e informe o nome do Savia e a URL de conexão.",
    ],
  "Elige OAuth, acepta el aviso de servidor personalizado y deja seleccionado el Registro dinámico de cliente (DCR).":
    [
      "Elige OAuth, acepta el aviso de servidor personalizado y deja seleccionado el Registro dinámico de cliente (DCR).",
      "Choose OAuth, accept the custom-server warning and keep Dynamic Client Registration (DCR) selected.",
      "Escolha OAuth, aceite o aviso de servidor personalizado e mantenha o Registro dinâmico de cliente (DCR) selecionado.",
    ],
  "Pulsa Iniciar sesión con Savia, completa el login y aprueba solo los permisos necesarios.":
    [
      "Pulsa Iniciar sesión con Savia, completa el login y aprueba solo los permisos necesarios.",
      "Click Sign in with Savia, complete login and approve only the required permissions.",
      "Clique em Entrar com Savia, conclua o login e aprove apenas as permissões necessárias.",
    ],
  "Pulsa Actualizar en el conector y verifica que aparecen acciones como listar colecciones.":
    [
      "Pulsa Actualizar en el conector y verifica que aparecen acciones como listar colecciones.",
      "Click Refresh in the connector and verify that actions such as listing collections appear.",
      "Clique em Atualizar no conector e verifique se aparecem ações como listar coleções.",
    ],
  "Abre los ajustes de conectores de Claude y elige Añadir conector personalizado.":
    [
      "Abre los ajustes de conectores de Claude y elige Añadir conector personalizado.",
      "Open Claude's connector settings and choose Add custom connector.",
      "Abra as configurações de conectores do Claude e escolha Adicionar conector personalizado.",
    ],
  "Pega la misma URL de conexión y elige OAuth.": [
    "Pega la misma URL de conexión y elige OAuth.",
    "Paste the same connection URL and choose OAuth.",
    "Cole a mesma URL de conexão e escolha OAuth.",
  ],
  "Completa el registro dinámico (DCR), inicia sesión en Savia y aprueba los permisos.":
    [
      "Completa el registro dinámico (DCR), inicia sesión en Savia y aprueba los permisos.",
      "Complete dynamic registration (DCR), sign in to Savia and approve the permissions.",
      "Conclua o registro dinâmico (DCR), entre no Savia e aprove as permissões.",
    ],
  "Vuelve a Claude y pide descubrir datos, por ejemplo: Lista las colecciones a las que tengo acceso.":
    [
      "Vuelve a Claude y pide descubrir datos, por ejemplo: Lista las colecciones a las que tengo acceso.",
      "Go back to Claude and ask to discover data, for example: List the collections I can access.",
      "Volte ao Claude e peça para descobrir dados, por exemplo: Liste as coleções às quais tenho acesso.",
    ],
  "Permisos que aprobarás": [
    "Permisos que aprobarás",
    "Permissions you will approve",
    "Permissões que você aprovará",
  ],
  "Lectura para descubrir y leer colecciones y empleados.": [
    "Lectura para descubrir y leer colecciones y empleados.",
    "Read to discover and read collections and employees.",
    "Leitura para descobrir e ler coleções e funcionários.",
  ],
  "Escritura para mutaciones autorizadas y confirmación de acciones pendientes.":
    [
      "Escritura para mutaciones autorizadas y confirmación de acciones pendientes.",
      "Write for authorized mutations and pending-action confirmations.",
      "Escrita para mutações autorizadas e confirmação de ações pendentes.",
    ],
  "Acceso sin conexión para renovar tokens (offline_access).": [
    "Acceso sin conexión para renovar tokens (offline_access).",
    "Offline access to refresh tokens (offline_access).",
    "Acesso offline para renovar tokens (offline_access).",
  ],
  "Si algo falla": ["Si algo falla", "If something fails", "Se algo falhar"],
  "Si no ves acciones tras conectar, usa Actualizar en el conector y revisa que la URL termine en /mcp.":
    [
      "Si no ves acciones tras conectar, usa Actualizar en el conector y revisa que la URL termine en /mcp.",
      "If you see no actions after connecting, use Refresh in the connector and check that the URL ends in /mcp.",
      "Se não vir ações após conectar, use Atualizar no conector e verifique se a URL termina em /mcp.",
    ],
  "Usa siempre el callback exacto que muestra tu cliente. No reutilices callbacks de otra cuenta.":
    [
      "Usa siempre el callback exacto que muestra tu cliente. No reutilices callbacks de otra cuenta.",
      "Always use the exact callback shown by your client. Do not reuse callbacks from another account.",
      "Use sempre o callback exato mostrado pelo seu cliente. Não reutilize callbacks de outra conta.",
    ],
  "Localhost o IPs privadas no funcionan con clientes en la nube: usa el entorno desplegado HTTPS.":
    [
      "Localhost o IPs privadas no funcionan con clientes en la nube: usa el entorno desplegado HTTPS.",
      "Localhost or private IPs do not work with cloud clients: use the deployed HTTPS environment.",
      "Localhost ou IPs privadas não funcionam com clientes na nuvem: use o ambiente HTTPS implantado.",
    ],
  "Qué puedes hacer después": [
    "Qué puedes hacer después",
    "What you can do next",
    "O que você pode fazer depois",
  ],
  "Pide listar colecciones antes de usar un identificador y menciona a un empleado para una tarea.":
    [
      "Pide listar colecciones antes de usar un identificador y menciona a un empleado para una tarea.",
      "Ask to list collections before using an identifier and mention an employee for a task.",
      "Peça para listar coleções antes de usar um identificador e mencione um funcionário para uma tarefa.",
    ],
} as const;
