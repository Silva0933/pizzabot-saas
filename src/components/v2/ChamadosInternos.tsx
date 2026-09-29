import { useEffect, useState } from "react";
import { BellRing, BookOpen, Loader2, MessageSquare, Plus, Send, Trash2 } from "lucide-react";
import { Chamado, ItemConhecimento, chamadosApi, conhecimentoApi } from "../../lib/api";

// ============================================
// Chamados abertos pela atendente (topo da tela Conversas)
// ============================================
// A atendente não tinha a resposta (ou uma operação no pedido falhou) e perguntou
// à equipe. Quem responde aqui responde ao cliente: a atendente transmite a
// resposta na conversa. "Salvar como conhecimento" ensina a próxima vez.
const ROTULO_MOTIVO: Record<string, string> = {
  sem_resposta: "Pergunta sem resposta cadastrada",
  falha_operacao: "Não consegui fazer no pedido",
};

function haQuanto(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return min < 1 ? "agora" : `há ${min} min`;
}

export function ChamadosAbertos({ pizzariaId, liveEvent, onAbrirConversa }: {
  pizzariaId: string;
  liveEvent?: { tipo: string; payload: any } | null;
  onAbrirConversa: (conversaId: string) => void;
}) {
  const [chamados, setChamados] = useState<Chamado[]>([]);

  function carregar() {
    chamadosApi.list(pizzariaId, "aberto").then(setChamados).catch(() => {});
  }

  useEffect(carregar, [pizzariaId]);
  useEffect(() => {
    if (liveEvent?.tipo?.startsWith("chamado.")) carregar();
  }, [liveEvent]);

  if (!chamados.length) return null;
  return (
    <section className="mb-4 space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-amber-300">
        <BellRing className="h-4 w-4 animate-pulse" />
        A atendente precisa de você ({chamados.length})
      </h3>
      {chamados.map((c) => (
        <div key={c.id}>
          <CartaoChamado pizzariaId={pizzariaId} chamado={c}
            onRespondido={() => setChamados((atual) => atual.filter((x) => x.id !== c.id))}
            onAbrirConversa={onAbrirConversa} />
        </div>
      ))}
    </section>
  );
}

function CartaoChamado({ pizzariaId, chamado, onRespondido, onAbrirConversa }: {
  pizzariaId: string;
  chamado: Chamado;
  onRespondido: () => void;
  onAbrirConversa: (conversaId: string) => void;
}) {
  const [resposta, setResposta] = useState("");
  const [salvar, setSalvar] = useState(chamado.motivo === "sem_resposta");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function responder() {
    if (!resposta.trim()) return;
    setEnviando(true);
    setErro(null);
    try {
      await chamadosApi.responder(pizzariaId, chamado.id, resposta.trim(), salvar);
      onRespondido();
    } catch (e: any) {
      setErro(e?.status === 409 ? "Esse chamado já foi encerrado (respondido ou expirado)." : (e?.message || "Não foi possível responder."));
    } finally {
      setEnviando(false);
    }
  }

  const itens = chamado.contexto?.itens ?? [];
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-white">{chamado.cliente_nome || chamado.telefone}</p>
        <span className="text-[11px] text-amber-300/80">
          {ROTULO_MOTIVO[chamado.motivo] ?? chamado.motivo} · {haQuanto(chamado.created_at)}
        </span>
      </div>
      <p className="mt-2 rounded-xl border border-slate-800 bg-[#0b0e14] px-3 py-2 text-sm text-slate-100">
        “{chamado.pergunta}”
      </p>
      {itens.length > 0 && (
        <p className="mt-1.5 text-[11px] text-slate-400">Pedido em andamento: {itens.join(", ")}</p>
      )}
      <textarea
        value={resposta}
        onChange={(e) => setResposta(e.target.value)}
        rows={2}
        placeholder="Escreva a resposta — a atendente passa para o cliente"
        className="mt-3 w-full rounded-xl border border-slate-800 bg-[#111622] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500"
      />
      {erro && <p className="mt-1 text-xs text-rose-300">{erro}</p>}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={salvar} onChange={(e) => setSalvar(e.target.checked)} className="h-4 w-4 accent-amber-500" />
          Salvar como conhecimento (a atendente responde sozinha da próxima vez)
        </label>
        <div className="flex gap-2">
          {chamado.conversa_id && (
            <button type="button" onClick={() => onAbrirConversa(chamado.conversa_id!)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800">
              <MessageSquare className="h-3.5 w-3.5" /> Conversa
            </button>
          )}
          <button type="button" onClick={responder} disabled={enviando || !resposta.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50">
            {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Responder
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Base de conhecimento (Meu Negócio)
// ============================================
export function BaseConhecimento({ pizzariaId }: { pizzariaId: string }) {
  const [itens, setItens] = useState<ItemConhecimento[]>([]);
  const [pergunta, setPergunta] = useState("");
  const [resposta, setResposta] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    conhecimentoApi.list(pizzariaId).then(setItens).catch(() => {});
  }, [pizzariaId]);

  async function adicionar() {
    if (pergunta.trim().length < 3 || !resposta.trim()) return;
    setSalvando(true);
    try {
      const novo = await conhecimentoApi.criar(pizzariaId, pergunta.trim(), resposta.trim());
      setItens((atual) => [novo, ...atual]);
      setPergunta("");
      setResposta("");
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: string) {
    await conhecimentoApi.remover(pizzariaId, id).catch(() => {});
    setItens((atual) => atual.filter((i) => i.id !== id));
  }

  const inputCls = "w-full rounded-xl border border-slate-800 bg-[#111622] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-orange-500";
  return (
    <section className="rounded-2xl border border-slate-800/80 bg-[#161f30]/60 p-5 shadow-sm">
      <h3 className="mb-1 flex items-center gap-2.5 text-sm font-semibold text-slate-200">
        <span className="grid h-8 w-8 place-items-center rounded-xl border border-sky-500/30 bg-sky-500/15 text-sky-400">
          <BookOpen className="h-4 w-4" />
        </span>
        Base de conhecimento da atendente
      </h3>
      <p className="mb-4 text-xs text-slate-400">
        Respostas que a atendente usa sozinha. Entram aqui as que você salva ao responder um chamado — ou cadastre direto.
      </p>
      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
        <input value={pergunta} onChange={(e) => setPergunta(e.target.value)} placeholder="Pergunta (ex.: vocês têm estacionamento?)" className={inputCls} />
        <input value={resposta} onChange={(e) => setResposta(e.target.value)} placeholder="Resposta (ex.: temos, na lateral da loja)" className={inputCls} />
        <button type="button" onClick={adicionar} disabled={salvando}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50">
          {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Adicionar
        </button>
      </div>
      <div className="mt-4 space-y-2">
        {itens.length === 0 && <p className="text-xs italic text-slate-500">Nada cadastrado ainda.</p>}
        {itens.map((i) => (
          <div key={i.id} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-[#0b0e14] px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-200">{i.pergunta}</p>
              <p className="mt-0.5 text-xs text-slate-400">{i.resposta}</p>
            </div>
            <button type="button" onClick={() => remover(i.id)} title="Remover"
              className="p-1 text-slate-500 transition-colors hover:text-red-400">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
