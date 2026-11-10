import { useState, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "../lib/supabase";
import { buscarPaginado } from "../lib/supabaseFetch";
import { dataHojeBR, formatarDuracao } from "../lib/dateUtils";
import { usePollingFetch } from "../hooks/usePollingFetch";

// 1 linha por execução do robô — volume baixo, 5000 cobre com folga.
const MAX_LINHAS = 5000;

const COLUNAS =
  "id, data_execucao, capa_errada, capa_nova, analista, fluxo, status, qtd_itens, qtd_ok, " +
  "qtd_divergente, qtd_revisar, qtd_nao_inserida, qtd_nao_conferida, qtd_duplicada, " +
  "qtd_criadas, duracao_segundos, mensagem";

const STATUS_ITENS = [
  { chave: "ok", nome: "OK" },
  { chave: "divergente", nome: "Divergente" },
  { chave: "revisar", nome: "Revisar" },
  { chave: "nao_inserida", nome: "Não inserida" },
  { chave: "nao_conferida", nome: "Não conferida" },
  { chave: "duplicada", nome: "Duplicada" },
];

const TOTAIS_VAZIOS = {
  nexec: 0, nitens: 0, ncriadas: 0, ok: 0, divergente: 0, revisar: 0,
  nao_inserida: 0, nao_conferida: 0, duplicada: 0,
};

// timestamptz vem com fuso ("+00:00"); só acrescenta Z quando não vier
function formatarDataHora(iso) {
  if (!iso) return "—";
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : iso + "Z");
  return (
    `${String(d.getDate()).padStart(2, "0")}/` +
    `${String(d.getMonth() + 1).padStart(2, "0")}/` +
    `${d.getFullYear()} ` +
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  );
}

function inicioDoDiaISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function pendencias(r) {
  return (r.qtd_divergente || 0) + (r.qtd_revisar || 0) + (r.qtd_nao_inserida || 0) + (r.qtd_nao_conferida || 0);
}

function duracao(seg) {
  if (seg == null) return "—";
  return formatarDuracao(seg / 60) || "< 1 min";
}

export default function ExecucoesCapaNova({ tema, cores }) {
  const [busca, setBusca] = useState("");
  const [dataInicio, setDataInicio] = useState(dataHojeBR);
  const [dataFim, setDataFim] = useState("");
  const ITENS_POR_PAGINA = 20;
  const [pagina, setPagina] = useState(1);
  const [totais, setTotais] = useState(TOTAIS_VAZIOS);

  const accentColor = tema === "escuro" ? "#FFCB05" : "#FF0073";
  const corErro = tema === "escuro" ? "#f87171" : "#dc2626";

  const fetchExecucoes = useCallback(async (signal) => {
    // sem o desempate por id as páginas do .range() podem pular ou repetir linhas
    const montarQuery = () => {
      let q = supabase
        .from("execucoes_capa_nova")
        .select(COLUNAS)
        .order("data_execucao", { ascending: false })
        .order("id", { ascending: false });
      if (dataInicio) {
        q = q.gte("data_execucao", dataInicio);
      } else if (!dataFim) {
        q = q.gte("data_execucao", inicioDoDiaISO());
      }
      if (dataFim) q = q.lte("data_execucao", dataFim + "T23:59:59");
      if (signal) q = q.abortSignal(signal);
      return q;
    };
    return buscarPaginado(montarQuery, MAX_LINHAS);
  }, [dataInicio, dataFim]);

  const { data: dados, loading } = usePollingFetch(
    fetchExecucoes,
    120000,
    [dataInicio, dataFim]
  );

  // agregação no servidor: com filtros limpos os cards mostram o total geral
  useEffect(() => {
    let ativo = true;
    (async () => {
      let q = supabase
        .from("execucoes_capa_nova")
        .select(
          "nexec:id.count(), nitens:qtd_itens.sum(), ncriadas:qtd_criadas.sum(), ok:qtd_ok.sum(), " +
          "divergente:qtd_divergente.sum(), revisar:qtd_revisar.sum(), nao_inserida:qtd_nao_inserida.sum(), " +
          "nao_conferida:qtd_nao_conferida.sum(), duplicada:qtd_duplicada.sum()"
        );
      if (dataInicio) q = q.gte("data_execucao", dataInicio);
      if (dataFim) q = q.lte("data_execucao", dataFim + "T23:59:59");
      const { data, error } = await q;
      if (!ativo || error) return;
      const t = data?.[0] || {};
      const novo = {};
      for (const k of Object.keys(TOTAIS_VAZIOS)) novo[k] = Number(t[k]) || 0;
      setTotais(novo);
    })();
    return () => { ativo = false; };
  }, [dataInicio, dataFim]);

  let filtrados = dados;
  if (busca.trim()) {
    const termo = busca.trim().toLowerCase();
    filtrados = filtrados.filter((r) =>
      (r.capa_errada || "").toLowerCase().includes(termo) ||
      (r.capa_nova || "").toLowerCase().includes(termo)
    );
  }

  const totalPendencias = totais.divergente + totais.revisar + totais.nao_inserida + totais.nao_conferida;
  const chartData = STATUS_ITENS
    .map((s) => ({ nome: s.nome, valor: totais[s.chave] }))
    .filter((s) => s.valor > 0);

  const totalPaginas = Math.ceil(filtrados.length / ITENS_POR_PAGINA);
  const paginaSegura = Math.min(Math.max(1, pagina), Math.max(1, totalPaginas));
  const inicio = (paginaSegura - 1) * ITENS_POR_PAGINA;
  const paginaDados = filtrados.slice(inicio, inicio + ITENS_POR_PAGINA);

  const PAGINAS_VISIVEIS = 5;
  const metade = Math.floor(PAGINAS_VISIVEIS / 2);
  let inicioPaginas = Math.max(1, paginaSegura - metade);
  let fimPaginas = Math.min(totalPaginas, inicioPaginas + PAGINAS_VISIVEIS - 1);
  if (fimPaginas - inicioPaginas + 1 < PAGINAS_VISIVEIS) {
    inicioPaginas = Math.max(1, fimPaginas - PAGINAS_VISIVEIS + 1);
  }
  const paginasVisiveis = Array.from(
    { length: fimPaginas - inicioPaginas + 1 },
    (_, i) => inicioPaginas + i
  );

  function irParaPagina(p) {
    setPagina(Math.min(Math.max(1, p), totalPaginas));
  }


  function exportarExcel() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["", "", "", "Total de execuções", totais.nexec],
      ["", "", "", "Guias/consultas processadas", totais.nitens],
      ["", "", "", "Inseridas na capa nova", totais.ncriadas],
      ["", "", "", "Itens com pendência", totalPendencias],
      [],
      ["Data de Execução", "Analista", "Capa Errada", "Capa Nova", "Fluxo", "Itens", "OK", "Divergente",
        "Revisar", "Não Inserida", "Não Conferida", "Duplicada", "Inseridas", "Duração", "Status", "Mensagem"],
      ...filtrados.map((r) => [
        formatarDataHora(r.data_execucao),
        r.analista,
        r.capa_errada,
        r.capa_nova,
        r.fluxo === "consulta" ? "Consulta" : "Guia",
        r.qtd_itens,
        r.qtd_ok,
        r.qtd_divergente,
        r.qtd_revisar,
        r.qtd_nao_inserida,
        r.qtd_nao_conferida,
        r.qtd_duplicada,
        r.qtd_criadas,
        duracao(r.duracao_segundos),
        r.status === "erro" ? "Erro" : "Concluído",
        r.mensagem,
      ]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Capa Nova");
    XLSX.writeFile(wb, "execucoes_capa_nova.xlsx");
  }

  const estiloCard = { backgroundColor: cores.card, color: cores.texto, cursor: 'pointer' };
  const td = { color: cores.texto };

  return (
    <>
      {/* CARDS */}
      <div className="cards">
        <div className="card animated-card" style={estiloCard}>
          <h3>Total de Execuções</h3>
          <p>{totais.nexec.toLocaleString("pt-BR")}</p>
        </div>
        <div className="card animated-card" style={estiloCard}>
          <h3>Guias Processadas</h3>
          <p>{totais.nitens.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>lidas da capa errada</p>
        </div>
        <div className="card animated-card" style={estiloCard}>
          <h3>Inseridas na Capa Nova</h3>
          <p>{totais.ncriadas.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>nos registros filtrados</p>
        </div>
        <div className="card animated-card" style={estiloCard}>
          <h3>Itens com Pendência</h3>
          <p>{totalPendencias.toLocaleString("pt-BR")}</p>
          <p style={{ fontSize: 13, fontWeight: 400 }}>divergente, revisar ou não inserida</p>
        </div>
      </div>

      {/* GRÁFICO */}
      {chartData.length > 0 && (
        <div className="card animated-card" style={estiloCard}>
          <h3>Resultado das Guias por Status</h3>
          <div style={{ width: "100%", height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} layout="vertical">
                <XAxis type="number" stroke={cores.texto} tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="nome" width={130} stroke={cores.texto} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="valor" fill={accentColor} name="Guias" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* FILTROS */}
      <div className="filtro">
        <div className="linha-filtros">
          <div className="grupo-filtro">
            <label>Nº da Capa:</label>
            <input
              className="filtro-processo"
              type="text"
              placeholder="Capa errada ou nova"
              value={busca}
              onChange={(e) => { setBusca(e.target.value); setPagina(1); }}
            />
          </div>
          <div className="grupo-filtro">
            <label>Período:</label>
            <input className="filtro-data" type="date" value={dataInicio} onChange={(e) => { setDataInicio(e.target.value); setPagina(1); }} />
            <span className="ate-text">até</span>
            <input className="filtro-data" type="date" value={dataFim} onChange={(e) => { setDataFim(e.target.value); setPagina(1); }} />
          </div>
          <button
            className="btn-tema"
            onClick={() => { setBusca(""); setDataInicio(""); setDataFim(""); setPagina(1); }}
          >
            <span className="material-symbols-outlined">mop</span>
            Limpar Filtros
          </button>
        </div>
      </div>

      {/* TABELA */}
      <div className="tabela-container" style={{ backgroundColor: cores.card, color: cores.texto, marginTop: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid rgba(128,128,128,0.2)" }}>
          <h3 style={{ margin: 0 }}>Detalhamento</h3>
          <span style={{ fontSize: "13px", opacity: 0.8 }}>
            Mostrando {filtrados.length ? inicio + 1 : 0}—{Math.min(inicio + ITENS_POR_PAGINA, filtrados.length)} de {filtrados.length.toLocaleString("pt-BR")}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={td}>Data de Execução</th>
                <th style={td}>Analista</th>
                <th style={td}>Capa Errada</th>
                <th style={td}>Capa Nova</th>
                <th style={td}>Fluxo</th>
                <th style={td}>Itens</th>
                <th style={td}>OK</th>
                <th style={td}>Pendências</th>
                <th style={td}>Inseridas</th>
                <th style={td}>Duração</th>
                <th style={td}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} style={{ color: cores.texto, padding: 32 }}>Carregando...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={11} style={{ color: cores.texto, padding: 32 }}>Nenhum registro encontrado.</td></tr>
              ) : paginaDados.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{formatarDataHora(r.data_execucao)}</td>
                  <td style={td}>{r.analista || "—"}</td>
                  <td style={td}>{r.capa_errada}</td>
                  <td style={td}>{r.capa_nova}</td>
                  <td style={td}>{r.fluxo === "consulta" ? "Consulta" : "Guia"}</td>
                  <td style={td}>{r.qtd_itens}</td>
                  <td style={td}>{r.qtd_ok}</td>
                  <td style={td}>{pendencias(r)}</td>
                  <td style={td}>{r.qtd_criadas}</td>
                  <td style={td}>{duracao(r.duracao_segundos)}</td>
                  <td
                    style={{ color: r.status === "erro" ? corErro : cores.texto, fontWeight: r.status === "erro" ? 600 : 400 }}
                    title={r.mensagem || ""}
                  >
                    {r.status === "erro" ? "Erro" : "Concluído"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPaginas > 1 && (
          <div className="paginacao" style={{ borderTop: "1px solid rgba(128,128,128,0.2)" }}>
            <button className="paginacao-btn" onClick={() => irParaPagina(paginaSegura - 1)} disabled={paginaSegura <= 1}
              style={{ background: tema === "escuro" ? "#374151" : "#e5e7eb", color: cores.texto, fontWeight: "bold", padding: "6px 12px" }}>
              Anterior
            </button>
            {paginasVisiveis[0] > 1 && (
              <>
                <button className="paginacao-btn" onClick={() => irParaPagina(1)} style={{ background: cores.card, color: cores.texto }}>1</button>
                {paginasVisiveis[0] > 2 && <span style={{ color: cores.texto, opacity: 0.5 }}>...</span>}
              </>
            )}
            {paginasVisiveis.map(p => (
              <button key={p} className={`paginacao-btn ${p === paginaSegura ? "paginacao-ativa" : ""}`}
                onClick={() => irParaPagina(p)}
                style={{ background: p === paginaSegura ? accentColor : (tema === "escuro" ? "#374151" : "#e5e7eb"), color: p === paginaSegura ? "#fff" : cores.texto }}>
                {p}
              </button>
            ))}
            {paginasVisiveis[paginasVisiveis.length - 1] < totalPaginas && (
              <>
                {paginasVisiveis[paginasVisiveis.length - 1] < totalPaginas - 1 && <span style={{ color: cores.texto, opacity: 0.5 }}>...</span>}
                <button className="paginacao-btn" onClick={() => irParaPagina(totalPaginas)} style={{ background: cores.card, color: cores.texto }}>{totalPaginas}</button>
              </>
            )}
            <button className="paginacao-btn" onClick={() => irParaPagina(paginaSegura + 1)} disabled={paginaSegura >= totalPaginas}
              style={{ background: tema === "escuro" ? "#374151" : "#e5e7eb", color: cores.texto, fontWeight: "bold", padding: "6px 12px" }}>
              Próximo
            </button>
          </div>
        )}
      </div>

      <div className="acoes-tabela">
        <button className="btn-tema" onClick={exportarExcel}>
          <span className="material-symbols-outlined">download</span>
          Exportar Planilha
        </button>
      </div>
    </>
  );
}
