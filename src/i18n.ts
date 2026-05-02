import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type Locale = "es" | "fr" | "pt-BR";
type Key = keyof typeof fallback;
type Params = Record<string, string | number>;

const namespace = "aliou/pi-processes";

const fallback = {
  "kill.missingId": "Missing required parameter: id",
  "kill.notFound": "Process not found: {id}",
  "kill.terminated": 'Terminated "{name}" ({id})',
  "kill.timeout":
    'SIGTERM timed out for "{name}" ({id}). Run /ps and press x on terminate_timeout to force kill (SIGKILL).',
  "kill.failed": 'Failed to terminate "{name}" ({id})',
  "list.none": "No background processes running",
  "list.summary": "{count} process(es):\n{summary}",
  "list.header": "{count} process(es), {running} running/terminating",
  "list.field.processes": "Processes",
  "list.pid": "pid",
  "list.status": "status",
  "list.started": "started",
  "list.ended": "ended",
  "list.runtime": "runtime",
  "list.noRunning": "no running process",
  "list.finished": "{count} finished",
  "list.failed": "{count} failed",
  "list.killed": "{count} killed",
  "footer.running": "running",
  "footer.failed": "failed",
  "footer.killed": "killed",
} as const;

const translations: Record<Locale, Partial<Record<Key, string>>> = {
  es: {
    "kill.missingId": "Falta el parámetro requerido: id",
    "kill.notFound": "Proceso no encontrado: {id}",
    "kill.terminated": 'Proceso terminado "{name}" ({id})',
    "kill.timeout":
      'SIGTERM agotó el tiempo para "{name}" ({id}). Ejecuta /ps y pulsa x en terminate_timeout para forzar la finalización (SIGKILL).',
    "kill.failed": 'No se pudo terminar "{name}" ({id})',
    "list.none": "No hay procesos en segundo plano en ejecución",
    "list.summary": "{count} proceso(s):\n{summary}",
    "list.header": "{count} proceso(s), {running} en ejecución/terminando",
    "list.field.processes": "Procesos",
    "list.pid": "pid",
    "list.status": "estado",
    "list.started": "iniciado",
    "list.ended": "finalizado",
    "list.runtime": "duración",
    "list.noRunning": "ningún proceso en ejecución",
    "list.finished": "{count} finalizados",
    "list.failed": "{count} fallidos",
    "list.killed": "{count} terminados",
    "footer.running": "en ejecución",
    "footer.failed": "fallidos",
    "footer.killed": "terminados",
  },
  fr: {
    "kill.missingId": "Paramètre requis manquant : id",
    "kill.notFound": "Processus introuvable : {id}",
    "kill.terminated": 'Processus terminé "{name}" ({id})',
    "kill.timeout":
      'SIGTERM a expiré pour "{name}" ({id}). Exécutez /ps et appuyez sur x sur terminate_timeout pour forcer l’arrêt (SIGKILL).',
    "kill.failed": 'Impossible de terminer "{name}" ({id})',
    "list.none": "Aucun processus en arrière-plan en cours",
    "list.summary": "{count} processus :\n{summary}",
    "list.header": "{count} processus, {running} en cours/en arrêt",
    "list.field.processes": "Processus",
    "list.pid": "pid",
    "list.status": "état",
    "list.started": "démarré",
    "list.ended": "terminé",
    "list.runtime": "durée",
    "list.noRunning": "aucun processus en cours",
    "list.finished": "{count} terminés",
    "list.failed": "{count} échoués",
    "list.killed": "{count} tués",
    "footer.running": "en cours",
    "footer.failed": "échoués",
    "footer.killed": "tués",
  },
  "pt-BR": {
    "kill.missingId": "Parâmetro obrigatório ausente: id",
    "kill.notFound": "Processo não encontrado: {id}",
    "kill.terminated": 'Processo encerrado "{name}" ({id})',
    "kill.timeout":
      'SIGTERM esgotou o tempo para "{name}" ({id}). Execute /ps e pressione x em terminate_timeout para forçar o encerramento (SIGKILL).',
    "kill.failed": 'Falha ao encerrar "{name}" ({id})',
    "list.none": "Nenhum processo em segundo plano em execução",
    "list.summary": "{count} processo(s):\n{summary}",
    "list.header": "{count} processo(s), {running} em execução/encerrando",
    "list.field.processes": "Processos",
    "list.pid": "pid",
    "list.status": "status",
    "list.started": "iniciado",
    "list.ended": "finalizado",
    "list.runtime": "duração",
    "list.noRunning": "nenhum processo em execução",
    "list.finished": "{count} finalizados",
    "list.failed": "{count} com falha",
    "list.killed": "{count} encerrados",
    "footer.running": "em execução",
    "footer.failed": "com falha",
    "footer.killed": "encerrados",
  },
};

let currentLocale: string | undefined;

function format(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) =>
    String(params[key] ?? `{${key}}`),
  );
}

export function t(key: Key, params?: Params): string {
  const locale = currentLocale as Locale | undefined;
  const template = locale ? translations[locale]?.[key] : undefined;
  return format(template ?? fallback[key], params);
}

export function initI18n(pi: ExtensionAPI): void {
  pi.events?.emit?.("pi-core/i18n/registerBundle", {
    namespace,
    defaultLocale: "en",
    fallback,
    translations,
  });
  pi.events?.on?.("pi-core/i18n/localeChanged", (event: unknown) => {
    currentLocale =
      event && typeof event === "object" && "locale" in event
        ? String((event as { locale?: unknown }).locale ?? "")
        : undefined;
  });
  pi.events?.emit?.("pi-core/i18n/requestApi", {
    namespace,
    onApi(api: { getLocale?: () => string | undefined }) {
      currentLocale = api.getLocale?.();
    },
  });
}
