// O Supabase corta toda resposta em 1000 linhas no servidor (db-max-rows) e
// ignora .limit() maior que isso — paginar com .range() é a única saída.
export const PAGINA_SUPABASE = 1000;

// montarQuery precisa devolver uma query nova a cada chamada: reaproveitar o
// mesmo builder faria os .range() se acumularem.
export async function buscarPaginado(montarQuery, maxLinhas) {
  const todas = [];
  for (let inicio = 0; inicio < maxLinhas; inicio += PAGINA_SUPABASE) {
    const fim = Math.min(inicio + PAGINA_SUPABASE, maxLinhas) - 1;
    const { data, error } = await montarQuery().range(inicio, fim);
    // devolve vazio, nunca parcial: exibir uma fatia silenciosamente é o bug
    // que essa paginação existe para corrigir
    if (error) return [];
    if (!data || data.length === 0) break;
    todas.push(...data);
    // página incompleta = última; mantém o caso comum em 1 requisição
    if (data.length < PAGINA_SUPABASE) break;
  }
  return todas;
}
