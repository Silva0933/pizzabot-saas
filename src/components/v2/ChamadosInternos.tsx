import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, BookOpen, Bot, Clock3, Loader2, MessageSquare, Plus, RefreshCw, Send, Trash2, UserRound } from "lucide-react";
import { Chamado, ItemConhecimento, chamadosApi, conhecimentoApi } from "../../lib/api";

// ============================================
// Chat interno: a atendente traz dúvidas e problemas para a equipe
// ============================================
// A atendente não tinha a resposta (ou uma operação no pedido falhou) e abriu um
// chamado. Aqui é uma conversa com ela: a pergunta dela, a sua resposta e o que
// ela disse ao cliente com a informação nova. "Salvar como conhecimento" ensina
// a próxima vez.
const ROTULO_MOTIVO: Record<string, string> = {
  sem_resposta: "Pergunta que não sei responder",
  falha_operacao: "Não consegui fazer no pedido",
};

function hora(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function haQuanto(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  return `há ${Math.round(min / 60)} h`;
}

/** Situação do chamado como a equipe precisa ver. Responder não é resolver: só
 *  "Resolvido" depois que a resposta chegou ao cliente (A04, análise de 01/10). */
function situacao(c: Chamado): { rotulo: string; texto: string; ponto: string } {
  if (c.status === "aberto") return { rotulo: "Esperando sua resposta", texto: "text-amber-300", ponto: "animate-pulse bg-amber-400" };
  if (c.status === "expirado") return { rotulo: "Expirou — foi para atendimento humano", texto: "text-ink-muted", ponto: "bg-slate-600" };
  if (c.status !== "respondido") return { rotulo: c.status, texto: "text-ink-muted", ponto: "bg-slate-600" };
  switch (c.entrega_status) {
    case "pendente":
    case "enviando":
      return { rotulo: "Resposta recebida — enviando ao cliente", texto: "text-sky-300", ponto: "animate-pulse bg-sky-400" };
    case "falhou":
      return { rotulo: "Não chegou ao cliente — foi para atendimento humano", texto: "text-rose-300", ponto: "bg-rose-500" };
    case "humano":
      return { rotulo: "Resolvido pelo atendente", texto: "text-emerald-400", ponto: "bg-emerald-500" };
    default:
      return { rotulo: "Resolvido", texto: "text-emerald-400", ponto: "bg-emerald-500" };
  }
}

/** Quantos chamados estão esperando resposta (badge da aba). */
export function useChamadosAbertos(pizzariaId: string, liveEvent?: { tipo: string } | null): number {
  const [n, setN] = useState(0);
  function carregar() {
    chamadosApi.list(pizzariaId, "aberto").then((l) => setN(l.length)).catch(() => {});
  }
  useEffect(carregar, [pizzariaId]);
  useEffect(() => {
    if (liveEvent?.tipo?.startsWith("chamado.")) carregar();
  }, [liveEvent]);
  return n;
}

export function ChatInterno({ pizzariaId, liveEvent, onAbrirConversa }: {
  pizzariaId: string;
  liveEvent?: { tipo: string; payload: any } | null;
  onAbrirConversa: (conversaId: string) => void;
}) {
  const [chamados, setChamados] = useState<Chamado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ativoId, setAtivoId] = useState<string | null>(null);
  // Falha ao carregar não pode virar "Nenhuma dúvida": a equipe acharia que não
  // há cliente esperando (achado A13 da análise de 01/10, reproduzido com a API em 503).
  const [falhou, setFalhou] = useState(false);
  const [sincronizadoEm, setSincronizadoEm] = useState<Date | null>(null);

  function carregar() {
    return chamadosApi.list(pizzariaId)
      .then((l) => { setChamados(l); setFalhou(false); setSincronizadoEm(new Date()); })
      .catch(() => setFalhou(true));
  }

  useEffect(() => {
    setCarregando(true);
    carregar().finally(() => setCarregando(false));
  }, [pizzariaId]);
  useEffect(() => {
    if (liveEvent?.tipo?.startsWith("chamado.")) carregar();
  }, [liveEvent]);

  // Abertos primeiro (mais antigo no topo: é quem espera há mais tempo); depois o histórico.
  const ordenados = useMemo(() => {
    const abertos = chamados.filter((c) => c.status === "aberto")
      .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    const resto = chamados.filter((c) => c.status !== "aberto");
    return [...abertos, ...resto];
  }, [chamados]);

  const ativo = ordenados.find((c) => c.id === ativoId) ?? null;
  useEffect(() => {
    if (!ativoId && ordenados.length && typeof window !== "undefined" && window.innerWidth >= 768) {
      setAtivoId(ordenados[0].id);
    }
  }, [ordenados, ativoId]);

  if (carregando) {
    return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div>;
  }

  return (
    <div className="grid h-[calc(100vh-190px)] min-h-[500px] grid-cols-1 overflow-hidden rounded-2xl border border-line bg-canvas shadow-sm md:grid-cols-[340px_1fr]">
      <aside className={`flex-col border-r border-line bg-canvas ${ativo ? "hidden md:flex" : "flex"}`}>
        <div className="border-b border-line bg-surface p-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <Bot className="h-4 w-4 text-amber-400" /> Chat com a atendente
          </h2>
          <p className="mt-1 text-xs text-ink-muted">Dúvidas e problemas que ela trouxe para você resolver.</p>
        </div>
        {falhou && (
          <div role="alert" className="flex items-start gap-2 border-b border-rose-500/30 bg-rose-950/30 px-4 py-3 text-xs text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Não consegui carregar as dúvidas da atendente.</p>
              <p className="mt-0.5 text-rose-300/80">
                {sincronizadoEm
                  ? `Mostrando o que veio às ${hora(sincronizadoEm.toISOString())} — pode haver cliente esperando.`
                  : "Pode haver cliente esperando resposta."}
              </p>
            </div>
            <button type="button" onClick={() => { carregar(); }}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-400/40 px-2 py-1 font-semibold hover:bg-rose-900/40">
              <RefreshCw className="h-3.5 w-3.5" /> Tentar de novo
            </button>
          </div>
        )}
        <div className="flex-1 divide-y divide-[#1e293b]/40 overflow-y-auto">
          {ordenados.length === 0 && !falhou && (
            <div className="p-8 text-center text-sm text-ink-muted">
              <Bot className="mx-auto mb-2 h-8 w-8 opacity-30" />
              Nenhuma dúvida da atendente por enquanto.
            </div>
          )}
          {ordenados.map((c) => {
            const aberto = c.status === "aberto";
            const sit = situacao(c);
            return (
              <button key={c.id} type="button" onClick={() => setAtivoId(c.id)}
                className={`flex w-full gap-3 px-4 py-3.5 text-left transition-colors ${
                  c.id === ativo?.id ? "border-l-2 border-l-amber-500 bg-surface-muted" : aberto ? "bg-amber-950/20 hover:bg-amber-950/30" : "hover:bg-[#131926]"
                }`}>
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${sit.ponto}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-white">{c.cliente_nome || c.telefone}</span>
                    <span className="shrink-0 text-xs text-ink-muted">{haQuanto(c.created_at)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">{c.pergunta}</p>
                  <p className={`mt-0.5 text-xs font-semibold ${sit.texto}`}>{sit.rotulo}</p>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className={`h-full min-h-0 min-w-0 flex-col ${ativo ? "flex" : "hidden md:flex"}`}>
        {!ativo ? (
          <div className="grid flex-1 place-items-center text-sm text-ink-muted">Selecione uma conversa com a atendente.</div>
        ) : (
          <div key={ativo.id} className="flex h-full min-h-0 flex-col">
            <FioChamado pizzariaId={pizzariaId} chamado={ativo}
              onVoltar={() => setAtivoId(null)} onAbrirConversa={onAbrirConversa} onRespondido={() => { carregar(); }} />
          </div>
        )}
      </section>
    </div>
  );
}

function Balao({ lado, cor, icone, titulo, horario, children }: {
  lado: "esq" | "dir"; cor: string; icone: ReactNode; titulo: string; horario?: string; children: ReactNode;
}) {
  return (
    <div className={`flex gap-2.5 ${lado === "dir" ? "flex-row-reverse" : ""}`}>
      <span className={`mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full ${cor}`}>{icone}</span>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm ${lado === "dir" ? "rounded-tr-sm bg-orange-600/90 text-white" : "rounded-tl-sm border border-line bg-surface-muted text-slate-100"}`}>
        <p className={`text-xs font-bold ${lado === "dir" ? "text-orange-100" : "text-amber-300"}`}>{titulo}</p>
        <div className="mt-0.5 whitespace-pre-wrap text-sm">{children}</div>
        {horario && <p className={`mt-1 text-right text-xs ${lado === "dir" ? "text-orange-100/80" : "text-ink-muted"}`}>{horario}</p>}
      </div>
    </div>
  );
}

function FioChamado({ pizzariaId, chamado, onVoltar, onAbrirConversa, onRespondido }: {
  pizzariaId: string;
  chamado: Chamado;
  onVoltar: () => void;
  onAbrirConversa: (conversaId: string) => void;
  onRespondido: () => void;
}) {
  const [resposta, setResposta] = useState("");
  // Desmarcado por padrão: o que for salvo a atendente repete sozinha para
  // perguntas iguais. Resposta de um caso só ("hoje acabou a massa") não pode
  // virar regra da loja sem a equipe escolher (achado A10 da análise de 01/10).
  const [salvar, setSalvar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const aberto = chamado.status === "aberto";
  const itens = chamado.contexto?.itens ?? [];
  const cliente = chamado.cliente_nome || chamado.telefone;

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chamado.status, chamado.contexto?.mensagem_ao_cliente]);

  async function responder() {
    if (!resposta.trim()) return;
    setEnviando(true);
    setErro(null);
    try {
      await chamadosApi.responder(pizzariaId, chamado.id, resposta.trim(), salvar);
      setResposta("");
      onRespondido();
    } catch (e: any) {
      setErro(e?.status === 409 ? "Essa dúvida já foi encerrada (respondida ou expirada)." : (e?.message || "Não foi possível enviar."));
    } finally {
      setEnviando(false);
    }
  }

  const iconeBot = <Bot className="h-4 w-4 text-amber-300" />;
  return (
    <>
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <button type="button" onClick={onVoltar} className="text-ink-muted hover:text-white md:hidden"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">Cliente: {cliente}</p>
          <p className="text-xs text-ink-muted">{ROTULO_MOTIVO[chamado.motivo] ?? chamado.motivo}</p>
        </div>
        {chamado.conversa_id && (
          <button type="button" onClick={() => onAbrirConversa(chamado.conversa_id!)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-slate-800">
            <MessageSquare className="h-3.5 w-3.5" /> Ver conversa do cliente
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Balao lado="esq" cor="bg-amber-500/15 border border-amber-500/30" icone={iconeBot} titulo="Atendente" horario={hora(chamado.created_at)}>
          {chamado.motivo === "falha_operacao"
            ? <>Preciso de ajuda com o pedido de <strong>{cliente}</strong>:{"\n"}{chamado.pergunta}</>
            : <>O cliente <strong>{cliente}</strong> perguntou:{"\n"}“{chamado.pergunta}”{"\n\n"}Não tenho essa informação. O que respondo?</>}
          {itens.length > 0 && <p className="mt-2 text-xs text-ink-muted">Pedido em andamento: {itens.join(", ")}</p>}
        </Balao>

        {chamado.resposta && (
          <Balao lado="dir" cor="bg-orange-500/20 border border-orange-500/30" icone={<UserRound className="h-4 w-4 text-orange-300" />}
            titulo="Você" horario={hora(chamado.respondido_em)}>
            {chamado.resposta}
          </Balao>
        )}

        {chamado.status === "respondido" && (
          chamado.contexto?.mensagem_ao_cliente ? (
            <Balao lado="esq" cor="bg-amber-500/15 border border-amber-500/30" icone={iconeBot} titulo="Atendente">
              Obrigada! Passei para o cliente:{"\n"}“{chamado.contexto.mensagem_ao_cliente}”
            </Balao>
          ) : chamado.contexto?.humano_assumiu ? (
            <p className="text-center text-xs text-ink-muted">Um atendente já tinha assumido a conversa — responda o cliente por lá.</p>
          ) : chamado.entrega_status === "falhou" ? (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <div>
                <p className="font-semibold">Não consegui enviar sua resposta ao cliente.</p>
                <p className="mt-0.5 text-rose-300/80">
                  A conversa foi para atendimento humano — responda o cliente por lá.
                  {chamado.entrega_erro ? ` (${chamado.entrega_erro.slice(0, 120)})` : ""}
                </p>
              </div>
            </div>
          ) : (
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-ink-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              {chamado.entrega_erro
                ? "O envio falhou, tentando de novo…"
                : "A atendente está passando a resposta para o cliente…"}
            </p>
          )
        )}

        {chamado.status === "expirado" && (
          <p className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-center text-xs text-ink-muted">
            <Clock3 className="h-3.5 w-3.5" /> Ninguém respondeu a tempo: o cliente foi avisado e a conversa passou para atendimento humano.
          </p>
        )}
        <div ref={fimRef} />
      </div>

      {aberto && (
        <div className="border-t border-line bg-surface p-3">
          {erro && <p className="mb-2 text-xs text-rose-300">{erro}</p>}
          <div className="flex items-end gap-2">
            <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} rows={2}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); responder(); } }}
              placeholder="Responda a atendente — ela resolve com o cliente"
              className="flex-1 resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500" />
            <button type="button" onClick={responder} disabled={enviando || !resposta.trim()}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50" title="Enviar">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" checked={salvar} onChange={(e) => setSalvar(e.target.checked)} className="h-4 w-4 accent-amber-500" />
            Salvar como conhecimento — vale sempre: ela repete esta resposta para perguntas iguais
          </label>
        </div>
      )}
    </>
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

  const inputCls = "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-orange-500";
  return (
    <section className="rounded-2xl border border-line/80 bg-surface-muted/60 p-5 shadow-sm">
      <h3 className="mb-1 flex items-center gap-2.5 text-sm font-semibold text-slate-200">
        <span className="grid h-8 w-8 place-items-center rounded-xl border border-sky-500/30 bg-sky-500/15 text-sky-400">
          <BookOpen className="h-4 w-4" />
        </span>
        Base de conhecimento da atendente
      </h3>
      <p className="mb-4 text-xs text-ink-muted">
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
        {itens.length === 0 && <p className="text-xs italic text-ink-muted">Nada cadastrado ainda.</p>}
        {itens.map((i) => (
          <div key={i.id} className="flex items-start gap-3 rounded-xl border border-line bg-canvas px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-200">{i.pergunta}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{i.resposta}</p>
            </div>
            <button type="button" onClick={() => remover(i.id)} title="Remover"
              className="p-1 text-ink-muted transition-colors hover:text-red-400">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
