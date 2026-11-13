const BR_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dataHojeBR() {
  return BR_DATE_FMT.format(new Date());
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
