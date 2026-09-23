/** Display captions for request execution states; persisted state values stay unchanged. */
export const integrationMessages = {
  running: ["En proceso", "In progress", "Em andamento"],
  complete: ["Completada", "Completed", "Concluída"],
  failed: ["No se completó", "Not completed", "Não concluído"],
} as const;

/** Personal integrations (connections) and virtual AI employees UI copy. Keys are the Spanish source. */
export const personalIntegrationsMessages = {
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
      "en el chat, con acceso scoped a colecciones y base de conocimiento Cloudflare RAG.",
      "in chat, with scoped access to collections and the Cloudflare RAG knowledge base.",
      "no chat, com acesso com escopo a coleções e à base de conhecimento Cloudflare RAG.",
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
      "Crea tu primer empleado virtual asignándole un rol, colecciones permitidas y documentos para potenciar tu equipo.",
      "Create your first virtual employee by assigning a role, allowed collections, and documents to boost your team.",
      "Crie seu primeiro funcionário virtual atribuindo uma função, coleções permitidas e documentos para impulsionar sua equipe.",
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
  "Configura el perfil, personalidad, colecciones accesibles y base de conocimiento Cloudflare RAG.":
    [
      "Configura el perfil, personalidad, colecciones accesibles y base de conocimiento Cloudflare RAG.",
      "Configure the profile, personality, accessible collections, and Cloudflare RAG knowledge base.",
      "Configure o perfil, a personalidade, as coleções acessíveis e a base de conhecimento Cloudflare RAG.",
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
  "No hay colecciones disponibles en este dominio. Puedes añadir una abajo.": [
    "No hay colecciones disponibles en este dominio. Puedes añadir una abajo.",
    "No collections available in this domain. You can add one below.",
    "Nenhuma coleção disponível neste domínio. Você pode adicionar uma abaixo.",
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
} as const;
