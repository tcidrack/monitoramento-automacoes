const BR_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dataHojeBR() {
  return BR_DATE_FMT.format(new Date());
}

// Limites de um dia de Brasília (YYYY-MM-DD) como instante UTC ("...Z"), para
// filtrar colunas gravadas em UTC — timestamptz ou timestamp sem fuso com hora
// UTC (abas que exibem com iso + "Z"). Data crua ("2026-11-18") é lida pelo
// Postgres como meia-noite UTC = 21:00 do dia anterior em Brasília.
// Brasil sem horário de verão desde 2019 → -03:00 fixo.
// NÃO usar em colunas que guardam hora de Brasília sem fuso (ex.: regulacoes).
export function inicioDiaBR(dia) {
  return new Date(`${dia}T00:00:00-03:00`).toISOString();
}

export function fimDiaBR(dia) {
  return new Date(`${dia}T23:59:59.999-03:00`).toISOString();
}

// Auto-refresh das abas: 5 min. Devolve 0 (desligado) quando o período escolhido
// termina antes de hoje — dado histórico não muda, repetir a consulta só gasta banco.
export const POLLING_MS = 300000;

export function intervaloPolling(dataFim) {
  return dataFim && dataFim < dataHojeBR() ? 0 : POLLING_MS;
}

// Formata uma duração em minutos como "Xh Ymin" / "Y min" (null se < 1 min)
export function formatarDuracao(totalMin) {
  if (totalMin == null || totalMin < 1) return null;
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  if (h === 0) return `${m} min`;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}
