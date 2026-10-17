import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  FileText,
  RotateCw,
} from "lucide-react";
import type { PluginApi } from "@savia/plugin-sdk";
import { defineReactPlugin } from "@savia/plugin-sdk/react";
import "./styles.css";
import { DossierPanel } from "./dossier-panel";
import { formatDeadline, deadlineInstant } from "./deadline";
import { SearchFeed } from "./search-feed";
import { FilterAutocomplete } from "./filter-autocomplete";
import {
  CATALOG_FIELDS,
  loadSecopCatalog,
  needsSecopConnection,
  type CatalogField,
  type CatalogState,
} from "./catalogs";
import {
  COLLECTION,
  PAGE_SIZE,
  RequestSequence,
  getSecopDetail,
  isTrackingConflict,
  saveInterest,
  searchSecop,
  updateInterest,
  type Interest,
  type InterestStatus,
  type SearchInput,
  type SecopRow,
} from "./logic";

type Locale = "es" | "en" | "pt";
type RouteState = Record<string, string>;
type DossierTab = "summary" | "documents" | "requirements" | "company" | "chat";
const dossierTabs = new Set<DossierTab>([
  "summary",
  "documents",
  "requirements",
  "company",
  "chat",
]);
function routeTab(value: string | undefined): DossierTab {
  return dossierTabs.has(value as DossierTab)
    ? (value as DossierTab)
    : "summary";
}
const messages = {
  es: {
    filterLimit: "Máximo 20 valores por filtro",
    removeFilter: "Quitar filtro",
    availability: "Disponibilidad",
    activeOnly: "Vigentes con cierre futuro",
    allTenders: "Todos, incluidos cerrados",
    closedDeadline: "Cerró",
    colombiaTime: "Hora de Colombia",
    title: "Licitaciones SECOP",
    subtitle:
      "Busca procesos públicos y organiza el seguimiento que tu equipo decide guardar.",
    search: "Buscar procesos",
    interests: "Mis intereses",
    query: "Palabras clave",
    status: "Estado SECOP",
    entity: "Entidad",
    modality: "Modalidad",
    department: "Departamento",
    run: "Buscar",
    loading: "Consultando SECOP…",
    searchFirst:
      "Ingresa criterios y busca para consultar procesos disponibles.",
    deepLinkLoading: "Cargando licitación…",
    deepLinkError: "No se pudo cargar esta licitación.",
    deepLinkNotFound: "No encontramos esta licitación en SECOP.",
    back: "Volver a licitaciones",
    noResults: "No se encontraron procesos con estos criterios.",
    searchError: "No se pudo consultar SECOP. Inténtalo de nuevo.",
    resultCount: "procesos cargados",
    process: "Proceso",
    entityLabel: "Entidad",
    departmentLabel: "Departamento",
    amount: "Valor base",
    deadline: "Cierre",
    documents: "Documentos",
    source: "Ver en SECOP",
    save: "Seguir",
    saved: "Guardada",
    saving: "Guardando…",
    savedOk: "Oportunidad guardada en tus intereses.",
    alreadySaved: "Esta oportunidad ya está en tus intereses.",
    saveError: "No se pudo guardar la oportunidad.",
    previous: "Anterior",
    next: "Siguiente",
    page: "Página",
    emptyInterests: "Todavía no has guardado oportunidades.",
    loadingInterests: "Cargando intereses…",
    interestsError: "No se pudieron cargar tus intereses.",
    statusTrack: "Seguimiento",
    priority: "Prioridad",
    notes: "Notas",
    saveNotes: "Guardar seguimiento",
    savedChanges: "Seguimiento actualizado.",
    conflict:
      "Otro usuario cambió este registro. Se recargó la versión actual; revisa antes de guardar de nuevo.",
    updateError: "No se pudo actualizar el seguimiento.",
    normal: "Normal",
    low: "Baja",
    high: "Alta",
    interested: "Interesada",
    evaluating: "En evaluación",
    preparing: "Preparando oferta",
    submitted: "Presentada",
    awarded: "Adjudicada",
    discarded: "Descartada",
    owner: "Responsable",
    followUp: "Próximo seguimiento",
    noData: "Sin dato en SECOP",
    processId: "Proceso SECOP",
    sourceUnavailable: "Enlace SECOP no disponible",
    searchAria: "Criterios de búsqueda SECOP",
    results: "Resultados SECOP",
    savedList: "Oportunidades guardadas",
    sourceStatus: "Estado",
    sourceStatusLabel: "Estado SECOP actual",
    monitoringEnabled: "Monitoreo automático",
    lastCheck: "Última revisión",
    neverChecked: "Pendiente de primera revisión",
    monitorError: "No se pudo actualizar SECOP",
    monitorErrorAuthorization:
      "Vuelve a conectar SECOP en Fuentes y colecciones para continuar el monitoreo.",
    monitorErrorMissing:
      "No se encontró el proceso guardado. Se volverá a intentar automáticamente.",
    monitorErrorDeadline:
      "SECOP no tiene una fecha de cierre válida; no se enviarán recordatorios de cierre.",
    monitorErrorUnavailable:
      "SECOP no está disponible. Se volverá a intentar automáticamente.",
    monitorPauseByStatus:
      "Los procesos adjudicados o descartados se pausan automáticamente.",
    pageOf: "de",
    clearSearch: "Limpiar búsqueda",
    filtersHint: "Combina los filtros y pulsa Buscar para aplicarlos.",
    anyValue: "Todos",
    showOptions: "Mostrar opciones",
    loadingCatalog: "Cargando catálogo…",
    catalogError: "Catálogo no disponible",
    connectionHeading: "Conecta SECOP para esta cuenta",
    connectionHelp:
      "Esta cuenta aún no tiene una conexión SECOP autorizada. Abre Fuentes de datos para conectarla, o inicia sesión con la cuenta que ya la autorizó.",
    connectionCheck: "Volver a comprobar la conexión",
    optionsCount: "opciones",
    noOptions: "Sin coincidencias. Puedes escribir otro valor.",
    suggestionsHint:
      "Elige varios valores por filtro. Escribe para buscar; Enter añade otro valor.",
    searchTimeout: "SECOP tardó demasiado en responder. Inténtalo de nuevo.",
    searchAuthorization:
      "Revisa tus permisos y la conexión SECOP en Fuentes de datos para continuar.",
    loadMore: "Cargar más",
    loadingMore: "Cargando más procesos…",
    moreError:
      "No se pudieron cargar más procesos. Los resultados anteriores se conservaron.",
    retry: "Reintentar",
    endResults: "No hay más procesos para estos criterios.",
    appliedFilters: "Filtros aplicados",
  },
  en: {
    filterLimit: "Maximum 20 values per filter",
    removeFilter: "Remove filter",
    availability: "Availability",
    activeOnly: "Open with a future deadline",
    allTenders: "All, including closed",
    closedDeadline: "Closed",
    colombiaTime: "Colombia time",
    title: "SECOP tenders",
    subtitle:
      "Search public procurement and track the opportunities your team chooses to save.",
    search: "Search tenders",
    interests: "My interests",
    query: "Keywords",
    status: "SECOP status",
    entity: "Entity",
    modality: "Modality",
    department: "Department",
    run: "Search",
    loading: "Searching SECOP…",
    searchFirst: "Enter criteria and search to see available opportunities.",
    deepLinkLoading: "Loading tender…",
    deepLinkError: "Could not load this tender.",
    deepLinkNotFound: "This tender could not be found in SECOP.",
    back: "Back to tenders",
    noResults: "No tenders match these criteria.",
    searchError: "SECOP search failed. Try again.",
    resultCount: "tenders loaded",
    process: "Tender",
    entityLabel: "Entity",
    departmentLabel: "Department",
    amount: "Base value",
    deadline: "Deadline",
    documents: "Documents",
    source: "View on SECOP",
    save: "Track",
    saved: "Saved",
    saving: "Saving…",
    savedOk: "Opportunity saved to your interests.",
    alreadySaved: "This opportunity is already in your interests.",
    saveError: "Could not save this opportunity.",
    previous: "Previous",
    next: "Next",
    page: "Page",
    emptyInterests: "You have not saved any opportunities yet.",
    loadingInterests: "Loading interests…",
    interestsError: "Could not load your interests.",
    statusTrack: "Tracking status",
    priority: "Priority",
    notes: "Notes",
    saveNotes: "Save tracking",
    savedChanges: "Tracking updated.",
    conflict:
      "Another user changed this record. The current version was reloaded; review it before saving again.",
    updateError: "Could not update tracking.",
    normal: "Normal",
    low: "Low",
    high: "High",
    interested: "Interested",
    evaluating: "Evaluating",
    preparing: "Preparing bid",
    submitted: "Submitted",
    awarded: "Awarded",
    discarded: "Discarded",
    owner: "Owner",
    followUp: "Next follow-up",
    noData: "No SECOP data",
    processId: "SECOP process",
    sourceUnavailable: "SECOP link unavailable",
    searchAria: "SECOP search criteria",
    results: "SECOP results",
    savedList: "Saved opportunities",
    sourceStatus: "Status",
    sourceStatusLabel: "Current SECOP status",
    monitoringEnabled: "Automatic monitoring",
    lastCheck: "Last check",
    neverChecked: "Waiting for the first check",
    monitorError: "SECOP could not be updated",
    monitorErrorAuthorization:
      "Reconnect SECOP in Sources and collections to resume monitoring.",
    monitorErrorMissing:
      "The saved process could not be found. It will be retried automatically.",
    monitorErrorDeadline:
      "SECOP has no usable closing date; no closing reminder will be sent.",
    monitorErrorUnavailable:
      "SECOP is unavailable. It will be retried automatically.",
    monitorPauseByStatus: "Awarded or discarded processes pause automatically.",
    pageOf: "of",
    clearSearch: "Clear search",
    filtersHint: "Combine filters and select Search to apply them.",
    anyValue: "All",
    showOptions: "Show options",
    loadingCatalog: "Loading catalog…",
    catalogError: "Catalog unavailable",
    connectionHeading: "Connect SECOP for this account",
    connectionHelp:
      "This account does not have an authorized SECOP connection yet. Open Data sources to connect it, or sign in with the account that already authorized it.",
    connectionCheck: "Check the connection again",
    optionsCount: "options",
    noOptions: "No matches. You can type another value.",
    suggestionsHint:
      "Choose several values per filter. Type to search; Enter adds another value.",
    searchTimeout: "SECOP took too long to respond. Try again.",
    searchAuthorization:
      "Check your permissions and SECOP connection in Data sources to continue.",
    loadMore: "Load more",
    loadingMore: "Loading more tenders…",
    moreError:
      "More tenders could not be loaded. Previous results have been kept.",
    retry: "Retry",
    endResults: "No more tenders match these criteria.",
    appliedFilters: "Applied filters",
  },
  pt: {
    filterLimit: "Máximo de 20 valores por filtro",
    removeFilter: "Remover filtro",
    availability: "Disponibilidade",
    activeOnly: "Vigentes com prazo futuro",
    allTenders: "Todos, incluindo encerrados",
    closedDeadline: "Encerrou",
    colombiaTime: "Horário da Colômbia",
    title: "Licitações SECOP",
    subtitle:
      "Pesquise processos públicos e acompanhe as oportunidades que sua equipe decidir salvar.",
    search: "Buscar licitações",
    interests: "Meus interesses",
    query: "Palavras-chave",
    status: "Status SECOP",
    entity: "Entidade",
    modality: "Modalidade",
    department: "Departamento",
    run: "Buscar",
    loading: "Consultando SECOP…",
    searchFirst:
      "Informe os critérios e busque para consultar oportunidades disponíveis.",
    deepLinkLoading: "Carregando licitação…",
    deepLinkError: "Não foi possível carregar esta licitação.",
    deepLinkNotFound: "Esta licitação não foi encontrada no SECOP.",
    back: "Voltar às licitações",
    noResults: "Nenhuma licitação encontrada com estes critérios.",
    searchError: "Não foi possível consultar o SECOP. Tente novamente.",
    resultCount: "licitações carregadas",
    process: "Processo",
    entityLabel: "Entidade",
    departmentLabel: "Departamento",
    amount: "Valor base",
    deadline: "Prazo",
    documents: "Documentos",
    source: "Ver no SECOP",
    save: "Acompanhar",
    saved: "Salva",
    saving: "Salvando…",
    savedOk: "Oportunidade salva nos seus interesses.",
    alreadySaved: "Esta oportunidade já está nos seus interesses.",
    saveError: "Não foi possível salvar a oportunidade.",
    previous: "Anterior",
    next: "Próxima",
    page: "Página",
    emptyInterests: "Você ainda não salvou oportunidades.",
    loadingInterests: "Carregando interesses…",
    interestsError: "Não foi possível carregar seus interesses.",
    statusTrack: "Acompanhamento",
    priority: "Prioridade",
    notes: "Notas",
    saveNotes: "Salvar acompanhamento",
    savedChanges: "Acompanhamento atualizado.",
    conflict:
      "Outro usuário alterou este registro. A versão atual foi recarregada; revise antes de salvar novamente.",
    updateError: "Não foi possível atualizar o acompanhamento.",
    normal: "Normal",
    low: "Baixa",
    high: "Alta",
    interested: "Interessada",
    evaluating: "Em avaliação",
    preparing: "Preparando proposta",
    submitted: "Apresentada",
    awarded: "Adjudicada",
    discarded: "Descartada",
    owner: "Responsável",
    followUp: "Próximo acompanhamento",
    noData: "Sem dados no SECOP",
    processId: "Processo SECOP",
    sourceStatus: "Status",
    sourceStatusLabel: "Status atual no SECOP",
    monitoringEnabled: "Monitoramento automático",
    lastCheck: "Última verificação",
    neverChecked: "Aguardando a primeira verificação",
    monitorError: "Não foi possível atualizar o SECOP",
    monitorErrorAuthorization:
      "Reconecte o SECOP em Fontes e coleções para retomar o monitoramento.",
    monitorErrorMissing:
      "O processo salvo não foi encontrado. Uma nova tentativa será feita automaticamente.",
    monitorErrorDeadline:
      "O SECOP não tem uma data de encerramento válida; não haverá lembrete de encerramento.",
    monitorErrorUnavailable:
      "O SECOP está indisponível. Uma nova tentativa será feita automaticamente.",
    monitorPauseByStatus:
      "Processos adjudicados ou descartados são pausados automaticamente.",
    sourceUnavailable: "Link SECOP indisponível",
    searchAria: "Critérios de busca SECOP",
    results: "Resultados SECOP",
    savedList: "Oportunidades salvas",
    clearSearch: "Limpar busca",
    filtersHint: "Combine os filtros e selecione Buscar para aplicá-los.",
    anyValue: "Todos",
    showOptions: "Mostrar opções",
    loadingCatalog: "Carregando catálogo…",
    catalogError: "Catálogo indisponível",
    connectionHeading: "Conecte o SECOP a esta conta",
    connectionHelp:
      "Esta conta ainda não tem uma conexão SECOP autorizada. Abra Fontes de dados para conectá-la ou entre com a conta que já a autorizou.",
    connectionCheck: "Verificar a conexão novamente",
    optionsCount: "opções",
    noOptions: "Sem resultados. Você pode digitar outro valor.",
    suggestionsHint:
      "Escolha vários valores por filtro. Digite para buscar; Enter adiciona outro valor.",
    searchTimeout: "O SECOP demorou para responder. Tente novamente.",
    searchAuthorization:
      "Verifique suas permissões e a conexão SECOP em Fontes de dados para continuar.",
    loadMore: "Carregar mais",
    loadingMore: "Carregando mais licitações…",
    moreError:
      "Não foi possível carregar mais licitações. Os resultados anteriores foram mantidos.",
    retry: "Tentar novamente",
    endResults: "Não há mais licitações para estes critérios.",
    appliedFilters: "Filtros aplicados",
    pageOf: "de",
  },
} as const;

const catalog = Object.fromEntries(
  (Object.keys(messages.en) as Array<keyof typeof messages.en>).map((key) => [
    key,
    [messages.es[key], messages.en[key], messages.pt[key]],
  ]),
) as unknown as Record<
  keyof typeof messages.en,
  readonly [string, string, string]
>;

function isLocale(value: string | undefined): Locale {
  const language = value?.toLowerCase().split("-")[0];
  return language === "en" || language === "pt" ? language : "es";
}
function monitorErrorMessage(
  value: unknown,
  t: (typeof messages)[Locale],
): string {
  switch (value) {
    case "authorization_required":
      return t.monitorErrorAuthorization;
    case "record_missing":
      return t.monitorErrorMissing;
    case "invalid_deadline":
      return t.monitorErrorDeadline;
    case "source_unavailable":
      return t.monitorErrorUnavailable;
    default:
      return t.monitorError;
  }
}
function formatMonitorCheck(
  value: unknown,
  locale: Locale,
  fallback: string,
): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return fallback;
  const dateLocale =
    locale === "en" ? "en-US" : locale === "pt" ? "pt-BR" : "es-CO";
  try {
    return new Intl.DateTimeFormat(dateLocale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Bogota",
    }).format(at);
  } catch {
    return fallback;
  }
}
function Deadline({ value, locale }: { value: unknown; locale: Locale }) {
  const t = messages[locale];
  const instant = deadlineInstant(value);
  if (instant === null) return <span>{t.noData}</span>;
  const closed = instant <= Date.now();
  return (
    <span className={closed ? "secop-deadline-closed" : undefined}>
      <time dateTime={new Date(instant).toISOString()}>
        {formatDeadline(value, locale, t.noData)}
      </time>
      {closed && (
        <span className="secop-deadline-label">{t.closedDeadline}</span>
      )}
    </span>
  );
}

function filterText(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : (value?.trim() ?? "");
}
function display(value: unknown, fallback: string) {
  if (value === undefined || value === null || String(value).trim() === "")
    return fallback;
  return String(value);
}
function sourceLink(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
function formatAmount(value: unknown, locale: Locale) {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    !Number.isFinite(Number(value))
  )
    return "—";
  return new Intl.NumberFormat(
    locale === "es" ? "es-CO" : locale === "pt" ? "pt-BR" : "en-US",
    { style: "currency", currency: "COP", maximumFractionDigits: 0 },
  ).format(Number(value));
}

function Screen({ savia }: { savia: PluginApi }) {
  const routeApi = savia.route;
  const locale = isLocale(savia.i18n?.locale);
  const t = new Proxy(messages[locale], {
    get(target, property: string) {
      if (property in catalog)
        return (
          savia.i18n?.translate(catalog, property as keyof typeof catalog) ??
          target[property as keyof typeof target]
        );
      return target[property as keyof typeof target];
    },
  });
  const [documentRow, setDocumentRow] = useState<SecopRow | null>(null);
  const [routeState, setRouteState] = useState<RouteState | null>(
    routeApi ? null : {},
  );
  const [routeLoad, setRouteLoad] = useState<
    "idle" | "loading" | "error" | "not-found" | "ready"
  >(routeApi ? "loading" : "idle");
  const [loadedTender, setLoadedTender] = useState("");
  const [routeRetry, setRouteRetry] = useState(0);
  const routeLookup = useRef(0);
  const routeRevision = useRef(0);
  const routeRead = useRef(0);
  const routeWrite = useRef(0);
  const [surface, setSurface] = useState<"search" | "interests">("search");
  const [draft, setDraft] = useState<SearchInput>({});
  const feed = useMemo(
    () => new SearchFeed((input) => searchSecop(savia, input)),
    [savia],
  );
  const {
    result: searchPage,
    criteria,
    loading: searchLoading,
    error: searchError,
    errorKind: searchErrorKind,
    searched,
  } = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
  const [catalogs, setCatalogs] = useState<Record<CatalogField, CatalogState>>(
    () => ({
      departamento: { options: [], loading: true, error: false },
      entidad: { options: [], loading: true, error: false },
      modalidad: { options: [], loading: true, error: false },
    }),
  );
  const catalogRequests = useRef(new RequestSequence()).current;
  const catalogGeneration = useRef(0);
  async function loadCatalog(field: CatalogField, generation: number) {
    setCatalogs((current) => ({
      ...current,
      [field]: { ...current[field], loading: true, error: false },
    }));
    try {
      const options = await loadSecopCatalog(savia, field);
      if (catalogRequests.isCurrent(generation))
        setCatalogs((current) => ({
          ...current,
          [field]: { options, loading: false, error: false },
        }));
    } catch (error) {
      if (catalogRequests.isCurrent(generation))
        setCatalogs((current) => ({
          ...current,
          [field]: {
            options: current[field].options,
            loading: false,
            error: true,
            connectionRequired: needsSecopConnection(error),
          },
        }));
    }
  }
  useEffect(() => {
    const generation = catalogRequests.begin();
    catalogGeneration.current = generation;
    void Promise.allSettled(
      CATALOG_FIELDS.map((field) => loadCatalog(field, generation)),
    );
    return () => catalogRequests.invalidate();
  }, [savia]);
  const connectionRequired =
    Object.values(catalogs).some((item) => item.connectionRequired) ||
    searchErrorKind === "connection";
  const searchSentinel = useRef<HTMLDivElement>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [interestPage, setInterestPage] = useState(1);
  const [interestTotal, setInterestTotal] = useState(0);
  const [interestQuery, setInterestQuery] = useState("");
  const [interestQueryDraft, setInterestQueryDraft] = useState("");
  const [interestLoading, setInterestLoading] = useState(false);
  const [interestError, setInterestError] = useState(false);
  const [edits, setEdits] = useState<
    Record<
      string,
      {
        notes: string;
        status: InterestStatus;
        priority: string;
        owner: string;
        next_follow_up: string;
        monitoring_enabled: boolean;
      }
    >
  >({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const interestRequests = useRef(new RequestSequence()).current;
  const mounted = useRef(true);

  useEffect(() => {
    if (!routeApi) return;
    let active = true;
    const unsubscribe = routeApi.subscribe?.((next) => {
      routeRevision.current++;
      routeWrite.current++;
      setRouteState({ ...next });
    });
    const revision = routeRevision.current;
    const writeRevision = routeWrite.current;
    const request = ++routeRead.current;
    void routeApi
      .get()
      .then((state) => {
        if (
          active &&
          request === routeRead.current &&
          revision === routeRevision.current &&
          writeRevision === routeWrite.current
        ) {
          setRouteState({ ...state });
          routeWrite.current++;
        }
      })
      .catch(() => {
        if (
          active &&
          request === routeRead.current &&
          revision === routeRevision.current &&
          writeRevision === routeWrite.current
        )
          setRouteLoad("error");
      });
    return () => {
      active = false;
      routeRead.current++;
      unsubscribe?.();
    };
  }, [routeApi]);

  const routedTender = routeState?.tender?.trim() ?? "";
  useEffect(() => {
    if (!routeApi || routeState === null) return;
    if (!routedTender) {
      routeLookup.current++;
      setRouteLoad("idle");
      setDocumentRow(null);
      setLoadedTender("");
      return;
    }
    if (
      routedTender.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(routedTender)
    ) {
      routeLookup.current++;
      setDocumentRow(null);
      setLoadedTender("");
      setRouteLoad("not-found");
      return;
    }
    let active = true;
    const request = ++routeLookup.current;
    setDocumentRow(null);
    setLoadedTender("");
    setRouteLoad("loading");
    void getSecopDetail(savia, routedTender)
      .then((row) => {
        if (!active || request !== routeLookup.current) return;
        if (!row || String(row.process_id ?? "") !== routedTender) {
          setRouteLoad("not-found");
          return;
        }
        setDocumentRow(row);
        setLoadedTender(routedTender);
        setRouteLoad("ready");
      })
      .catch(() => {
        if (active && request === routeLookup.current) setRouteLoad("error");
      });
    return () => {
      active = false;
      if (routeLookup.current === request) routeLookup.current++;
    };
  }, [routeApi, routeState !== null, routedTender, routeRetry, savia]);

  const collection = useMemo(
    () => savia.collections.collection<Interest>(COLLECTION),
    [savia],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      feed.cancel();
      interestRequests.invalidate();
    };
  }, [feed]);
  useEffect(() => {
    const sentinel = searchSentinel.current;
    if (
      documentRow !== null ||
      surface !== "search" ||
      !sentinel ||
      !searchPage?.hasNext ||
      searchLoading ||
      searchError ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void feed.more();
      },
      { rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [feed, surface, documentRow, searchPage, searchLoading, searchError]);
  const loadInterests = async (nextPage: number, query = interestQuery) => {
    const id = interestRequests.begin();
    setInterestLoading(true);
    setInterestError(false);
    try {
      const result = await collection.list({
        page: nextPage,
        perPage: PAGE_SIZE,
        q: query,
        searchFields: [
          "name",
          "source_id",
          "process_id",
          "entity",
          "department",
          "notes",
        ],
      });
      if (!interestRequests.isCurrent(id)) return;
      setInterests(result.data);
      setInterestPage(result.page);
      setInterestTotal(result.total);
      setEdits((current) => {
        const updated = { ...current };
        for (const item of result.data)
          updated[item.id] = {
            notes: String(item.notes ?? ""),
            status: item.status,
            priority: String(item.priority ?? "normal"),
            owner: String(item.owner ?? ""),
            next_follow_up: String(item.next_follow_up ?? "").slice(0, 10),
            monitoring_enabled: item.monitoring_enabled !== false,
          };
        return updated;
      });
    } catch {
      if (interestRequests.isCurrent(id)) setInterestError(true);
    } finally {
      if (interestRequests.isCurrent(id)) setInterestLoading(false);
    }
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (connectionRequired) return;
    setNotice("");
    void feed.search(draft);
  };
  const submitInterestSearch = (event: FormEvent) => {
    event.preventDefault();
    setInterestQuery(interestQueryDraft);
    void loadInterests(1, interestQueryDraft);
  };
  const markInterest = async (row: SecopRow) => {
    setSavingId(row.id);
    setNotice("");
    try {
      const result = await saveInterest(savia, row);
      if (!mounted.current) return;
      setSavedIds((current) => new Set(current).add(row.id));
      setNotice(result.created ? t.savedOk : t.alreadySaved);
    } catch {
      if (!mounted.current) return;
      setNotice(t.saveError);
    } finally {
      if (mounted.current) setSavingId(null);
    }
  };
  const saveTracking = async (record: Interest) => {
    const values = edits[record.id];
    if (!values) return;
    setUpdatingId(record.id);
    setNotice("");
    try {
      const updated = await updateInterest(savia, record, values);
      if (!mounted.current) return;
      setInterests((current) =>
        current.map((item) => (item.id === record.id ? updated : item)),
      );
      setEdits((current) => ({
        ...current,
        [record.id]: {
          notes: String(updated.notes ?? ""),
          status: updated.status,
          priority: String(updated.priority ?? "normal"),
          owner: String(updated.owner ?? ""),
          next_follow_up: String(updated.next_follow_up ?? "").slice(0, 10),
          monitoring_enabled: updated.monitoring_enabled !== false,
        },
      }));
      setNotice(t.savedChanges);
    } catch (error) {
      if (!mounted.current) return;
      const localized = savia.i18n?.error(error);
      if (isTrackingConflict(localized) || isTrackingConflict(error)) {
        setNotice(t.conflict);
        try {
          const current = await collection.get(record.id);
          if (!mounted.current) return;
          setInterests((items) =>
            items.map((item) => (item.id === current.id ? current : item)),
          );
          setEdits((items) => ({
            ...items,
            [record.id]: {
              notes: String(current.notes ?? ""),
              status: current.status,
              priority: String(current.priority ?? "normal"),
              owner: String(current.owner ?? ""),
              next_follow_up: String(current.next_follow_up ?? "").slice(0, 10),
              monitoring_enabled: current.monitoring_enabled !== false,
            },
          }));
        } catch {
          setNotice(t.conflict);
        }
      } else setNotice(t.updateError);
    } finally {
      if (mounted.current) setUpdatingId(null);
    }
  };
  const statuses: InterestStatus[] = [
    "interested",
    "evaluating",
    "preparing",
    "submitted",
    "awarded",
    "discarded",
  ];
  const totalInterestPages = Math.max(1, Math.ceil(interestTotal / PAGE_SIZE));
  const activeDocumentRow = routeApi
    ? loadedTender === routedTender && routeLoad === "ready"
      ? documentRow
      : null
    : documentRow;

  const openTender = (row: SecopRow, tab: DossierTab = "documents") => {
    if (!routeApi) {
      setDocumentRow(row);
      return;
    }
    const processId = String(row.process_id ?? "").trim();
    if (
      !processId ||
      processId.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(processId)
    )
      return;
    const next = { tender: processId, tab };
    setRouteState(next);
    const write = ++routeWrite.current;
    void routeApi.set(next).catch(() => {
      if (routeWrite.current === write) setRouteLoad("error");
    });
  };
  const leaveTender = () => {
    setDocumentRow(null);
    if (!routeApi) return;
    setRouteState({});
    const write = ++routeWrite.current;
    void routeApi.set({}, { replace: true }).catch(() => {
      if (routeWrite.current === write) setRouteLoad("error");
    });
  };
  const changeTenderTab = (tab: DossierTab) => {
    if (!routeApi || !routedTender) return;
    const next = { ...(routeState ?? {}), tender: routedTender, tab };
    setRouteState(next);
    const write = ++routeWrite.current;
    void routeApi.set(next).catch(() => {
      if (routeWrite.current === write) setRouteLoad("error");
    });
  };

  if (
    routeApi &&
    (routeState === null ||
      (routedTender &&
        (routeLoad !== "ready" || loadedTender !== routedTender)))
  )
    return (
      <main className="secop-app" lang={locale}>
        <header className="secop-header">
          <div>
            <p className="secop-eyebrow">SECOP · Colombia</p>
            <h1>{t.title}</h1>
          </div>
        </header>
        <p
          className="secop-state"
          role={routeLoad === "error" ? "alert" : "status"}
        >
          {routeLoad === "loading"
            ? t.deepLinkLoading
            : routeLoad === "not-found"
              ? t.deepLinkNotFound
              : t.deepLinkError}
        </p>
        {routeLoad === "error" && (
          <button
            type="button"
            onClick={() => {
              if (routeState === null) {
                setRouteLoad("loading");
                const request = ++routeRead.current;
                const revision = routeRevision.current;
                const writeRevision = routeWrite.current;
                void routeApi
                  .get()
                  .then((state) => {
                    if (
                      request === routeRead.current &&
                      revision === routeRevision.current &&
                      writeRevision === routeWrite.current
                    ) {
                      setRouteState({ ...state });
                      routeWrite.current++;
                    }
                  })
                  .catch(() => {
                    if (
                      request === routeRead.current &&
                      revision === routeRevision.current &&
                      writeRevision === routeWrite.current
                    )
                      setRouteLoad("error");
                  });
              } else setRouteRetry((attempt) => attempt + 1);
            }}
          >
            {t.retry}
          </button>
        )}
        {(routeLoad === "error" || routeLoad === "not-found") && (
          <button type="button" onClick={leaveTender}>
            {t.back}
          </button>
        )}
      </main>
    );

  if (activeDocumentRow)
    return (
      <DossierPanel
        key={String(activeDocumentRow.process_id)}
        savia={savia}
        row={activeDocumentRow}
        locale={locale}
        tab={routeApi ? routeTab(routeState?.tab) : undefined}
        onTabChange={routeApi ? changeTenderTab : undefined}
        onBack={leaveTender}
      />
    );
  return (
    <main className="secop-app">
      <header className="secop-header">
        <div>
          <p className="secop-eyebrow">SECOP · Colombia</p>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </header>
      <nav className="secop-tabs" aria-label={t.title}>
        <button
          type="button"
          aria-pressed={surface === "search"}
          onClick={() => setSurface("search")}
        >
          {t.search}
        </button>
        <button
          type="button"
          aria-pressed={surface === "interests"}
          onClick={() => {
            setSurface("interests");
            void loadInterests(1);
          }}
        >
          {t.interests}
        </button>
      </nav>
      {notice && (
        <p className="secop-notice" role="status">
          {notice}
        </p>
      )}
      {surface === "search" ? (
        <>
          {connectionRequired && (
            <aside
              className="secop-notice secop-connection-required"
              role="alert"
            >
              <strong>{t.connectionHeading}</strong>
              <p>{t.connectionHelp}</p>
              <button
                type="button"
                onClick={() => {
                  for (const field of CATALOG_FIELDS)
                    void loadCatalog(field, catalogGeneration.current);
                  if (searched) void feed.search(criteria);
                }}
              >
                {t.connectionCheck}
              </button>
            </aside>
          )}
          <form
            className="secop-search"
            onSubmit={submitSearch}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.target as HTMLElement).tagName === "INPUT"
              )
                submitSearch(event);
            }}
            aria-label={t.searchAria}
          >
            <label className="secop-query">
              {t.query}
              <input
                value={draft.q ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, q: event.target.value })
                }
              />
            </label>
            <label className="secop-availability">
              {t.availability}
              <select
                value={draft.vigentes === false ? "all" : "active"}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    vigentes: event.target.value === "active",
                  }))
                }
              >
                <option value="active">{t.activeOnly}</option>
                <option value="all">{t.allTenders}</option>
              </select>
            </label>
            <div className="secop-advanced">
              {(
                [
                  ["estado", "source_status", t.status],
                  ["entidad", "entity", t.entity],
                  ["modalidad", "modality", t.modality],
                  ["departamento", "department", t.department],
                ] as const
              ).map(([key, field, label]) => (
                <div key={key} className="secop-catalog-filter">
                  <FilterAutocomplete
                    id={`secop-filter-${key}`}
                    label={label}
                    multiple
                    value={
                      Array.isArray(draft[key])
                        ? (draft[key] as string[])
                        : draft[key]
                          ? [draft[key] as string]
                          : []
                    }
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, [key]: value }))
                    }
                    placeholder={t.anyValue}
                    removeLabel={t.removeFilter}
                    limitLabel={t.filterLimit}
                    toggleLabel={`${t.showOptions}: ${label}`}
                    noOptionsLabel={
                      key !== "estado" && catalogs[key].loading
                        ? t.loadingCatalog
                        : t.noOptions
                    }
                    options={
                      key === "estado"
                        ? Array.from(
                            new Set([
                              "Publicado",
                              "Borrador",
                              "Evaluación",
                              "Cancelado",
                              "Aprobado",
                              ...(searchPage?.data ?? []).map((row) =>
                                String(row[field] ?? "").trim(),
                              ),
                            ]),
                          )
                            .filter(Boolean)
                            .sort()
                        : catalogs[key].options
                    }
                  />
                  {key !== "estado" &&
                    (catalogs[key].loading ? (
                      <p
                        className="secop-catalog-status secop-loading"
                        role="status"
                      >
                        {t.loadingCatalog}
                      </p>
                    ) : catalogs[key].connectionRequired ? null : catalogs[key]
                        .error ? (
                      <div className="secop-catalog-error" role="alert">
                        <span>{t.catalogError}</span>
                        <button
                          type="button"
                          className="secop-catalog-retry"
                          aria-label={`${t.retry}: ${label}`}
                          title={`${t.retry}: ${label}`}
                          onClick={() => {
                            void loadCatalog(key, catalogGeneration.current);
                          }}
                        >
                          <RotateCw size={14} aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <p className="secop-catalog-status">
                        {catalogs[key].options.length.toLocaleString(
                          locale === "es"
                            ? "es-CO"
                            : locale === "pt"
                              ? "pt-BR"
                              : "en-US",
                        )}{" "}
                        {t.optionsCount}
                      </p>
                    ))}
                </div>
              ))}
            </div>
            <p className="secop-filter-hint">
              {t.filtersHint} {t.suggestionsHint}
            </p>
            <div className="secop-search-actions">
              <button
                type="button"
                className="secop-text-button"
                onClick={() => {
                  setDraft({});
                  setNotice("");
                  if (searched && !connectionRequired) void feed.search({});
                }}
              >
                {t.clearSearch}
              </button>
              <button
                className="secop-primary"
                type="button"
                onClick={submitSearch}
                disabled={connectionRequired || (searchLoading && !searchPage)}
              >
                {searchLoading && !searchPage ? t.loading : t.run}
              </button>
            </div>
          </form>
          <section aria-labelledby="secop-results-title">
            <div className="secop-section-head">
              <h2 id="secop-results-title">{t.results}</h2>
              {searchPage && (
                <span role="status">
                  {searchPage.data.length} {t.resultCount}
                </span>
              )}
            </div>
            {searched && (
              <p className="secop-filter-hint">
                {criteria.vigentes === false ? t.allTenders : t.activeOnly}
              </p>
            )}
            {searched &&
              (
                ["q", "estado", "entidad", "modalidad", "departamento"] as const
              ).some((key) => filterText(criteria[key])) && (
                <div
                  className="secop-applied-filters"
                  aria-label={t.appliedFilters}
                >
                  {(
                    [
                      ["q", t.query],
                      ["estado", t.status],
                      ["entidad", t.entity],
                      ["modalidad", t.modality],
                      ["departamento", t.department],
                    ] as const
                  )
                    .filter(([key]) => filterText(criteria[key]))
                    .map(([key, label]) => (
                      <span key={key}>
                        {label}: {filterText(criteria[key])}
                      </span>
                    ))}
                </div>
              )}
            {searchLoading && !searchPage && (
              <p className="secop-state secop-loading" role="status">
                {t.loading}
              </p>
            )}
            {searchError && !searchPage && !connectionRequired && (
              <p className="secop-error" role="alert">
                {searchErrorKind === "authorization"
                  ? t.searchAuthorization
                  : searchErrorKind === "timeout"
                    ? t.searchTimeout
                    : t.searchError}
                <button
                  type="button"
                  onClick={() => void feed.search(criteria)}
                >
                  {t.retry}
                </button>
              </p>
            )}
            {!searchLoading && !searchError && !searched && (
              <p className="secop-state">{t.searchFirst}</p>
            )}
            {!searchLoading &&
              !searchError &&
              searched &&
              searchPage?.data.length === 0 && (
                <p className="secop-state">{t.noResults}</p>
              )}
            {!!searchPage?.data.length && (
              <div className="secop-results">
                {searchPage.data.map((row) => {
                  const link = sourceLink(row.source_url);
                  const isSaved = savedIds.has(row.id);
                  return (
                    <article className="secop-card" key={row.id}>
                      <div className="secop-card-title">
                        <div>
                          <h3>{display(row.name, t.noData)}</h3>
                          <p>
                            {t.processId}: {display(row.process_id, row.id)}
                          </p>
                        </div>
                        <span className="secop-status">
                          {display(row.source_status, t.noData)}
                        </span>
                      </div>
                      <dl>
                        <div>
                          <dt>{t.entityLabel}</dt>
                          <dd>{display(row.entity, t.noData)}</dd>
                        </div>
                        <div>
                          <dt>{t.departmentLabel}</dt>
                          <dd>{display(row.department, t.noData)}</dd>
                        </div>
                        <div>
                          <dt>{t.amount}</dt>
                          <dd>{formatAmount(row.amount, locale)}</dd>
                        </div>
                        <div>
                          <dt>
                            {t.deadline} · {t.colombiaTime}
                          </dt>
                          <dd>
                            <Deadline value={row.deadline} locale={locale} />
                          </dd>
                        </div>
                      </dl>
                      <footer>
                        <button
                          type="button"
                          className="secop-icon-action"
                          aria-label={t.documents}
                          title={t.documents}
                          onClick={() => openTender(row, "documents")}
                        >
                          <FileText
                            className="secop-action-icon"
                            size={16}
                            aria-hidden="true"
                          />
                        </button>
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="secop-icon-action"
                            aria-label={t.source}
                            title={t.source}
                          >
                            <ExternalLink
                              className="secop-action-icon"
                              size={16}
                              aria-hidden="true"
                            />
                          </a>
                        ) : (
                          <span className="secop-muted">
                            {t.sourceUnavailable}
                          </span>
                        )}
                        <button
                          type="button"
                          className="secop-icon-action"
                          aria-label={
                            savingId === row.id
                              ? t.saving
                              : isSaved
                                ? t.saved
                                : t.save
                          }
                          title={
                            savingId === row.id
                              ? t.saving
                              : isSaved
                                ? t.saved
                                : t.save
                          }
                          disabled={isSaved || savingId === row.id}
                          onClick={() => void markInterest(row)}
                        >
                          {isSaved ? (
                            <BookmarkCheck
                              className="secop-action-icon"
                              size={16}
                              aria-hidden="true"
                            />
                          ) : (
                            <Bookmark
                              className="secop-action-icon"
                              size={16}
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      </footer>
                    </article>
                  );
                })}
              </div>
            )}
            {!!searchPage?.data.length && (
              <div className="secop-load-more" ref={searchSentinel}>
                {searchError && (
                  <p className="secop-error" role="alert">
                    {searchErrorKind === "authorization"
                      ? t.searchAuthorization
                      : searchErrorKind === "timeout"
                        ? t.searchTimeout
                        : t.moreError}
                  </p>
                )}
                {searchLoading && (
                  <p className="secop-loading" role="status">
                    {t.loadingMore}
                  </p>
                )}
                {searchPage.hasNext ? (
                  <button
                    type="button"
                    disabled={searchLoading}
                    onClick={() => void feed.more()}
                  >
                    {searchError ? t.retry : t.loadMore}
                  </button>
                ) : (
                  <p role="status">{t.endResults}</p>
                )}
              </div>
            )}
          </section>
        </>
      ) : (
        <section aria-labelledby="secop-interests-title">
          <div className="secop-section-head">
            <h2 id="secop-interests-title">{t.savedList}</h2>
            <span>
              {interestTotal} {t.interests.toLowerCase()}
            </span>
          </div>
          <form
            className="secop-interest-search"
            onSubmit={submitInterestSearch}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.target as HTMLElement).tagName === "INPUT"
              )
                submitInterestSearch(event);
            }}
          >
            <label>
              {t.query}
              <input
                value={interestQueryDraft}
                onChange={(event) => setInterestQueryDraft(event.target.value)}
              />
            </label>
            <button
              className="secop-primary"
              type="button"
              onClick={submitInterestSearch}
            >
              {t.run}
            </button>
          </form>
          {interestLoading && (
            <p className="secop-state secop-loading" role="status">
              {t.loadingInterests}
            </p>
          )}
          {interestError && (
            <p className="secop-error" role="alert">
              {t.interestsError}
              <button
                type="button"
                onClick={() => void loadInterests(interestPage)}
              >
                {t.run}
              </button>
            </p>
          )}
          {!interestLoading && !interestError && interests.length === 0 && (
            <p className="secop-state">{t.emptyInterests}</p>
          )}
          <div className="secop-interests">
            {interests.map((record) => {
              const values = edits[record.id] ?? {
                notes: String(record.notes ?? ""),
                status: record.status,
                priority: String(record.priority ?? "normal"),
                owner: String(record.owner ?? ""),
                next_follow_up: String(record.next_follow_up ?? "").slice(
                  0,
                  10,
                ),
                monitoring_enabled: record.monitoring_enabled !== false,
              };
              const link = sourceLink(record.source_url);
              return (
                <article className="secop-interest" key={record.id}>
                  <header>
                    <div>
                      <h3>{record.name}</h3>
                      <p>
                        {t.processId}:{" "}
                        {display(record.process_id, record.source_id)} ·{" "}
                        {display(record.entity, t.noData)}
                      </p>
                    </div>
                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="secop-icon-action"
                        aria-label={t.source}
                        title={t.source}
                      >
                        <ExternalLink size={16} aria-hidden="true" />
                      </a>
                    )}
                  </header>
                  <button
                    type="button"
                    className="secop-icon-action"
                    aria-label={t.documents}
                    title={t.documents}
                    onClick={() =>
                      openTender({ ...record, id: record.id }, "documents")
                    }
                  >
                    <FileText size={16} aria-hidden="true" />
                  </button>
                  <div
                    className="secop-monitor-facts"
                    aria-label={t.sourceStatusLabel}
                  >
                    <p>
                      <strong>{t.sourceStatusLabel}:</strong>{" "}
                      {display(record.source_status, t.noData)}
                    </p>
                    <p>
                      <strong>{t.deadline}:</strong>{" "}
                      <Deadline value={record.deadline} locale={locale} />
                    </p>
                    <p>
                      <strong>{t.lastCheck}:</strong>{" "}
                      {formatMonitorCheck(
                        record.monitoring_checked_at,
                        locale,
                        t.neverChecked,
                      )}
                    </p>
                    {record.monitoring_error && (
                      <p className="secop-monitor-error" role="status">
                        {monitorErrorMessage(record.monitoring_error, t)}
                      </p>
                    )}
                  </div>
                  <div className="secop-edit-grid">
                    <label className="secop-monitor-toggle">
                      <input
                        type="checkbox"
                        checked={values.monitoring_enabled}
                        onChange={(event) =>
                          setEdits({
                            ...edits,
                            [record.id]: {
                              ...values,
                              monitoring_enabled: event.target.checked,
                            },
                          })
                        }
                      />
                      <span>
                        {t.monitoringEnabled}
                        <small
                          className="secop-muted"
                          style={{ display: "block" }}
                        >
                          {t.monitorPauseByStatus}
                        </small>
                      </span>
                    </label>
                    <label>
                      {t.statusTrack}
                      <select
                        value={values.status}
                        onChange={(event) =>
                          setEdits({
                            ...edits,
                            [record.id]: {
                              ...values,
                              status: event.target.value as InterestStatus,
                            },
                          })
                        }
                      >
                        {statuses.map((status) => (
                          <option key={status} value={status}>
                            {t[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t.priority}
                      <select
                        value={values.priority}
                        onChange={(event) =>
                          setEdits({
                            ...edits,
                            [record.id]: {
                              ...values,
                              priority: event.target.value,
                            },
                          })
                        }
                      >
                        <option value="low">{t.low}</option>
                        <option value="normal">{t.normal}</option>
                        <option value="high">{t.high}</option>
                      </select>
                    </label>
                    <label>
                      {t.owner}
                      <input
                        maxLength={120}
                        value={values.owner}
                        onChange={(event) =>
                          setEdits({
                            ...edits,
                            [record.id]: {
                              ...values,
                              owner: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      {t.followUp}
                      <input
                        type="date"
                        value={values.next_follow_up}
                        onChange={(event) =>
                          setEdits({
                            ...edits,
                            [record.id]: {
                              ...values,
                              next_follow_up: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <label className="secop-wide">
                      {t.notes}
                      <textarea
                        maxLength={4000}
                        value={values.notes}
                        onChange={(event) =>
                          setEdits({
                            ...edits,
                            [record.id]: {
                              ...values,
                              notes: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                  <footer>
                    <span>
                      {t.processId}:{" "}
                      {display(record.process_id, record.source_id)}
                    </span>
                    <button
                      type="button"
                      disabled={updatingId === record.id}
                      onClick={() => void saveTracking(record)}
                    >
                      {updatingId === record.id ? t.saving : t.saveNotes}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
          {interestTotal > PAGE_SIZE && (
            <div className="secop-pagination">
              <span>
                {t.page} {interestPage} {t.pageOf} {totalInterestPages}
              </span>
              <div>
                <button
                  type="button"
                  disabled={interestLoading || interestPage <= 1}
                  onClick={() => void loadInterests(interestPage - 1)}
                >
                  {t.previous}
                </button>
                <button
                  type="button"
                  disabled={
                    interestLoading || interestPage >= totalInterestPages
                  }
                  onClick={() => void loadInterests(interestPage + 1)}
                >
                  {t.next}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

const plugin = defineReactPlugin(Screen);
export const { render, renderPanel } = plugin;
