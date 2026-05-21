const BR_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function dataHojeBR() {
  return BR_DATE_FMT.format(new Date());
}
