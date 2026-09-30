import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BadgePercent,
  Check,
  Eye,
  EyeOff,
  Image,
  Loader2,
  Megaphone,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  BackendProduto,
  CampanhaCardapio,
  cardapioApi,
  CupomCardapio,
  pizzariasApi,
  TemaCardapioConfig,
  BackendPizzaria,
} from "../../lib/api";

const MAX_COLAGEM = 3;

interface Props {
  pizzariaId: string;
  onBack?: () => void;
  onUpdated?: (pizzaria: BackendPizzaria) => void;
}

type Tab = "campanhas" | "cupons";

const uid = (prefix: string) =>
  `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;

const novaCampanha = (ordem: number): CampanhaCardapio => ({
  id: uid("campanha"),
  titulo: "Oferta especial",
  subtitulo: "Conte aos clientes por que vale a pena pedir agora.",
  imagem_url: "",
  etiqueta: "OFERTA",
  cta_label: "Aproveitar oferta",
  cupom_codigo: "",
  ativa: true,
  ordem,
});

const novoCupom = (): CupomCardapio => ({
  id: uid("cupom"),
  codigo: "PROMO10",
  descricao: "10% de desconto no pedido",
  tipo: "percentual",
  valor: 10,
  pedido_minimo: 0,
  validade: null,
  ativo: true,
});

export function PromocoesCardapioPanel({ pizzariaId, onBack, onUpdated }: Props) {
  const [tab, setTab] = useState<Tab>("campanhas");
  const [tema, setTema] = useState<TemaCardapioConfig>({});
  const [campanhas, setCampanhas] = useState<CampanhaCardapio[]>([]);
  const [cupons, setCupons] = useState<CupomCardapio[]>([]);
  const [mostrarAcompanhamento, setMostrarAcompanhamento] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    pizzariasApi.get(pizzariaId)
      .then((pizzaria) => {
        if (!active) return;
        const atual = pizzaria.tema_cardapio || {};
        setTema(atual);
        setCampanhas([...(atual.campanhas || [])].sort((a, b) => a.ordem - b.ordem));
        setCupons(atual.cupons || []);
        setMostrarAcompanhamento(atual.mostrar_acompanhamento !== false);
      })
      .catch((e) => active && setError(e.message || "Não foi possível carregar as promoções."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [pizzariaId]);

  // Produtos com foto, para escolher as fotos da colagem do cartão da campanha.
  const [produtosComFoto, setProdutosComFoto] = useState<BackendProduto[]>([]);
  useEffect(() => {
    let active = true;
    cardapioApi.list(pizzariaId)
      .then((lista) => {
        if (!active) return;
        setProdutosComFoto(lista.filter((p) => p.imagem_url && p.disponivel).sort((a, b) => a.ordem - b.ordem));
      })
      .catch(() => { /* sem a lista, a colagem segue automática */ });
    return () => { active = false; };
  }, [pizzariaId]);

  /** Marca/desmarca um produto da colagem, respeitando o limite de 3 e a ordem do clique. */
  function alternarProdutoColagem(campanha: CampanhaCardapio, produtoId: string) {
    const atual = campanha.produtos_colagem || [];
    const proximo = atual.includes(produtoId)
      ? atual.filter((id) => id !== produtoId)
      : atual.length >= MAX_COLAGEM ? atual : [...atual, produtoId];
    updateCampanha(campanha.id, { produtos_colagem: proximo });
  }

  const campanhaAtiva = useMemo(
    () => campanhas.filter((item) => item.ativa).sort((a, b) => a.ordem - b.ordem)[0],
    [campanhas],
  );
  const cuponsAtivos = cupons.filter((item) => item.ativo).length;

  function updateCampanha(id: string, patch: Partial<CampanhaCardapio>) {
    setCampanhas((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    setSaved(false);
  }

  function updateCupom(id: string, patch: Partial<CupomCardapio>) {
    setCupons((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    setSaved(false);
  }

  function moveCampanha(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= campanhas.length) return;
    const next = [...campanhas];
    [next[index], next[target]] = [next[target], next[index]];
    setCampanhas(next.map((item, ordem) => ({ ...item, ordem })));
    setSaved(false);
  }

  async function save() {
    setError(null);
    const codigos = cupons.map((item) => item.codigo.trim().toUpperCase()).filter(Boolean);
    if (campanhas.some((item) => !item.titulo.trim())) {
      setError("Dê um título a todos os banners antes de salvar.");
      return;
    }
    if (cupons.some((item) => !item.codigo.trim() || Number(item.valor) <= 0)) {
      setError("Todo cupom precisa de código e valor maior que zero.");
      return;
    }
    if (new Set(codigos).size !== codigos.length) {
      setError("Existem cupons com o mesmo código.");
      return;
    }

    setSaving(true);
    try {
      const campanhasNormalizadas = campanhas.map((item, ordem) => ({ ...item, ordem }));
      const cuponsNormalizados = cupons.map((item) => ({
        ...item,
        codigo: item.codigo.trim().toUpperCase(),
        valor: Number(item.valor),
        pedido_minimo: Number(item.pedido_minimo || 0),
      }));
      const atualizado: TemaCardapioConfig = {
        ...tema,
        campanhas: campanhasNormalizadas,
        cupons: cuponsNormalizados,
        mostrar_acompanhamento: mostrarAcompanhamento,
      };
      const pizzariaAtualizada = await pizzariasApi.update(pizzariaId, { tema_cardapio: atualizado });
      onUpdated?.(pizzariaAtualizada);
      setTema(atualizado);
      setCampanhas(campanhasNormalizadas);
      setCupons(cuponsNormalizados);
      setSaved(true);
    } catch (e: any) {
      setError(e.message || "Não foi possível salvar as alterações.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[420px] grid place-items-center rounded-xl border border-line bg-surface">
        <div className="flex items-center gap-2 text-ink-muted text-sm"><Loader2 className="w-5 h-5 animate-spin text-orange-500" /> Carregando divulgação...</div>
      </div>
    );
  }

  return (
    <div className="max-w-[1500px] mx-auto space-y-6">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            {onBack && (
              <button type="button" onClick={onBack} className="mt-0.5 w-10 h-10 grid place-items-center rounded-xl border border-line bg-surface-muted text-ink-muted hover:text-white hover:bg-surface-elevated transition" aria-label="Voltar aos temas">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h2 className="text-base font-semibold text-ink">Banners, ofertas e cupons</h2>
              <p className="pzb-page-description">Crie campanhas que combinam com a marca e convertem visitas em pedidos.</p>
            </div>
          </div>
          <button type="button" onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-xs font-semibold disabled:opacity-60 transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saving ? "Salvando..." : saved ? "Alterações salvas" : "Salvar divulgação"}
          </button>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-xs font-medium text-red-300">{error}</div>}

      <section className="grid sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-xs font-semibold tracking-normal text-ink-muted">Banners ativos</p>
          <strong className="block text-2xl font-semibold text-white mt-2">{campanhas.filter((item) => item.ativa).length}</strong>
          <small className="text-xs text-ink-subtle">de {campanhas.length} configurados</small>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-xs font-semibold tracking-normal text-ink-muted">Cupons ativos</p>
          <strong className="block text-2xl font-semibold text-white mt-2">{cuponsAtivos}</strong>
          <small className="text-xs text-ink-subtle">validados no servidor</small>
        </div>
        <button type="button" onClick={() => { setMostrarAcompanhamento((v) => !v); setSaved(false); }}
          className="rounded-xl border border-line bg-surface p-5 text-left hover:border-line transition">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold tracking-normal text-ink-muted">Acompanhar pedido</p>
            {mostrarAcompanhamento ? <Eye className="w-4 h-4 text-emerald-400" /> : <EyeOff className="w-4 h-4 text-ink-subtle" />}
          </div>
          <strong className="block text-2xl font-semibold text-white mt-2">{mostrarAcompanhamento ? "Visível" : "Oculto"}</strong>
          <small className="text-xs text-ink-subtle">Número + telefone do cliente</small>
        </button>
      </section>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        <section className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="pzb-tablist m-3" aria-label="Tipos de divulgação">
            <button type="button" onClick={() => setTab("campanhas")}
              aria-pressed={tab === "campanhas"} data-active={tab === "campanhas"}
              className={`pzb-tab flex-1 ${tab === "campanhas" ? "bg-orange-500/10 text-orange-400 border-orange-500/30" : "text-ink-muted hover:text-ink hover:bg-surface-muted"}`}>
              Banners e ofertas
            </button>
            <button type="button" onClick={() => setTab("cupons")}
              aria-pressed={tab === "cupons"} data-active={tab === "cupons"}
              className={`pzb-tab flex-1 ${tab === "cupons" ? "bg-orange-500/10 text-orange-400 border-orange-500/30" : "text-ink-muted hover:text-ink hover:bg-surface-muted"}`}>
              Cupons de desconto
            </button>
          </div>

          {tab === "campanhas" ? (
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div><h3 className="font-semibold text-sm text-white">Campanhas do cardápio</h3><p className="text-xs text-ink-muted mt-0.5">A primeira campanha ativa ganha maior destaque.</p></div>
                <button type="button" onClick={() => { setCampanhas((c) => [...c, novaCampanha(c.length)]); setSaved(false); }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-400 text-xs font-semibold hover:bg-orange-500/20 transition">
                  <Plus className="w-3.5 h-3.5" /> Novo banner
                </button>
              </div>
              {campanhas.length === 0 && (
                <div className="py-12 text-center rounded-xl border border-dashed border-line bg-surface-muted/40">
                  <Image className="w-8 h-8 text-ink-subtle mx-auto mb-3" />
                  <p className="text-sm font-semibold text-white">Nenhuma campanha criada</p>
                  <p className="text-xs text-ink-muted mt-1">Adicione uma oferta para destacar no cardápio.</p>
                </div>
              )}
              {campanhas.map((item, index) => (
                <article key={item.id} className="rounded-xl border border-line bg-surface-muted p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="w-7 h-7 grid place-items-center rounded-lg bg-orange-500/20 text-orange-400 text-xs font-semibold">{index + 1}</span>
                      <div>
                        <strong className="text-xs font-semibold text-white block">{item.titulo || "Banner sem título"}</strong>
                        <small className="block text-xs text-ink-muted">{item.ativa ? "Publicado no cardápio" : "Oculto do público"}</small>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => moveCampanha(index, -1)} disabled={index === 0} className="w-7 h-7 grid place-items-center rounded-lg text-ink-muted hover:text-white hover:bg-surface disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => moveCampanha(index, 1)} disabled={index === campanhas.length - 1} className="w-7 h-7 grid place-items-center rounded-lg text-ink-muted hover:text-white hover:bg-surface disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => { if (confirm("Remover este banner?")) setCampanhas((c) => c.filter((x) => x.id !== item.id)); }} className="w-7 h-7 grid place-items-center rounded-lg text-red-400 hover:bg-red-950/40"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-3 pt-2">
                    <label className="space-y-1"><span className="text-xs font-semibold text-ink-muted">Título</span><input value={item.titulo} onChange={(e) => updateCampanha(item.id, { titulo: e.target.value })} className="admin-promo-input" placeholder="Ex: Festival de pizzas" /></label>
                    <label className="space-y-1"><span className="text-xs font-semibold text-ink-muted">Etiqueta</span><input value={item.etiqueta || ""} onChange={(e) => updateCampanha(item.id, { etiqueta: e.target.value })} className="admin-promo-input" placeholder="OFERTA DA SEMANA" /></label>
                    <label className="md:col-span-2 space-y-1"><span className="text-xs font-semibold text-ink-muted">Descrição</span><input value={item.subtitulo || ""} onChange={(e) => updateCampanha(item.id, { subtitulo: e.target.value })} className="admin-promo-input" placeholder="Uma frase curta e convincente" /></label>
                    <label className="md:col-span-2 space-y-1"><span className="text-xs font-semibold text-ink-muted">URL da imagem</span><input value={item.imagem_url || ""} onChange={(e) => updateCampanha(item.id, { imagem_url: e.target.value })} className="admin-promo-input" placeholder="https://.../foto-da-oferta.jpg" /></label>
                    <label className="space-y-1"><span className="text-xs font-semibold text-ink-muted">Texto do botão</span><input value={item.cta_label || ""} onChange={(e) => updateCampanha(item.id, { cta_label: e.target.value })} className="admin-promo-input" placeholder="Pedir agora" /></label>
                    <label className="space-y-1"><span className="text-xs font-semibold text-ink-muted">Cupom associado</span><select value={item.cupom_codigo || ""} onChange={(e) => updateCampanha(item.id, { cupom_codigo: e.target.value })} className="admin-promo-input"><option value="">Sem cupom</option>{cupons.map((c) => <option key={c.id} value={c.codigo}>{c.codigo || "Cupom sem código"}</option>)}</select></label>
                  </div>
                  <div className="pt-1 space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-semibold text-ink-muted">Fotos da colagem</span>
                      <span className="text-xs text-ink-subtle">
                        {(item.produtos_colagem || []).length}/{MAX_COLAGEM} escolhidos
                      </span>
                    </div>
                    <p className="text-xs text-ink-subtle">
                      Escolha até 3 produtos: as fotos deles aparecem no cartão, na ordem em que você clicar.
                      Sem escolha, o cardápio usa a imagem acima e as primeiras fotos do cardápio.
                    </p>
                    {produtosComFoto.length === 0 ? (
                      <p className="text-xs text-ink-subtle rounded-xl border border-dashed border-line px-3 py-3">
                        Nenhum produto com foto no cardápio. Adicione fotos em Cardápio para escolher aqui.
                      </p>
                    ) : (
                      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-56 overflow-y-auto pr-1">
                        {produtosComFoto.map((p) => {
                          const posicao = (item.produtos_colagem || []).indexOf(p.id);
                          const marcado = posicao >= 0;
                          const cheio = !marcado && (item.produtos_colagem || []).length >= MAX_COLAGEM;
                          return (
                            <button key={p.id} type="button" disabled={cheio} aria-pressed={marcado}
                              title={cheio ? `Máximo de ${MAX_COLAGEM} fotos` : p.nome}
                              onClick={() => alternarProdutoColagem(item, p.id)}
                              className={`relative rounded-xl overflow-hidden border-2 text-left transition ${marcado ? "border-orange-500" : "border-transparent hover:border-line"} disabled:opacity-35 disabled:cursor-not-allowed`}>
                              <img src={p.imagem_url || ""} alt="" className="w-full aspect-square object-cover" loading="lazy" />
                              <span className="block truncate px-1.5 py-1 text-xs text-ink-muted bg-surface">{p.nome}</span>
                              {marcado && (
                                <span className="absolute top-1 right-1 w-5 h-5 grid place-items-center rounded-full bg-brand-700 text-white text-xs font-semibold shadow">{posicao + 1}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {(item.produtos_colagem || []).length > 0 && (
                      <button type="button" onClick={() => updateCampanha(item.id, { produtos_colagem: [] })}
                        className="text-xs font-semibold text-ink-muted hover:text-orange-400">
                        Voltar para a escolha automática
                      </button>
                    )}
                  </div>
                  <button type="button" onClick={() => updateCampanha(item.id, { ativa: !item.ativa })}
                    className={`mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border ${item.ativa ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-line text-ink-muted"}`}>
                    {item.ativa ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} {item.ativa ? "Banner ativo" : "Banner desativado"}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div><h3 className="font-semibold text-sm text-white">Cupons de desconto</h3><p className="text-xs text-ink-muted mt-0.5">O valor é conferido novamente no servidor ao fechar o pedido.</p></div>
                <button type="button" onClick={() => { setCupons((c) => [...c, novoCupom()]); setSaved(false); }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-400 text-xs font-semibold hover:bg-orange-500/20 transition"><Plus className="w-3.5 h-3.5" /> Novo cupom</button>
              </div>
              {cupons.length === 0 && <div className="py-12 text-center rounded-xl border border-dashed border-line bg-surface-muted/40"><BadgePercent className="w-8 h-8 text-ink-subtle mx-auto mb-3" /><p className="text-sm font-semibold text-white">Nenhum cupom criado</p><p className="text-xs text-ink-muted mt-1">Crie descontos percentuais ou em reais.</p></div>}
              {cupons.map((item) => (
                <article key={item.id} className="rounded-xl border border-line bg-surface-muted p-4">
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <label className="space-y-1"><span className="text-xs font-semibold text-ink-muted">Código</span><input value={item.codigo} onChange={(e) => updateCupom(item.id, { codigo: e.target.value.toUpperCase().replace(/\s/g, "") })} className="admin-promo-input font-mono" placeholder="PROMO10" /></label>
                    <label className="space-y-1"><span className="text-xs font-semibold text-ink-muted">Tipo</span><select value={item.tipo} onChange={(e) => updateCupom(item.id, { tipo: e.target.value as CupomCardapio["tipo"] })} className="admin-promo-input"><option value="percentual">Percentual (%)</option><option value="fixo">Valor fixo (R$)</option></select></label>
                    <label className="space-y-1"><span className="text-xs font-semibold text-ink-muted">Valor</span><input type="number" min="0.01" max={item.tipo === "percentual" ? 100 : undefined} step="0.01" value={item.valor} onChange={(e) => updateCupom(item.id, { valor: Number(e.target.value) })} className="admin-promo-input" /></label>
                    <label className="space-y-1"><span className="text-xs font-semibold text-ink-muted">Pedido mínimo (R$)</span><input type="number" min="0" step="0.01" value={item.pedido_minimo || 0} onChange={(e) => updateCupom(item.id, { pedido_minimo: Number(e.target.value) })} className="admin-promo-input" /></label>
                    <label className="space-y-1"><span className="text-xs font-semibold text-ink-muted">Validade</span><input type="date" value={item.validade || ""} onChange={(e) => updateCupom(item.id, { validade: e.target.value || null })} className="admin-promo-input" /></label>
                    <label className="space-y-1"><span className="text-xs font-semibold text-ink-muted">Descrição</span><input value={item.descricao || ""} onChange={(e) => updateCupom(item.id, { descricao: e.target.value })} className="admin-promo-input" placeholder="Benefício para o cliente" /></label>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <button type="button" onClick={() => updateCupom(item.id, { ativo: !item.ativo })}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border ${item.ativo ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-line text-ink-muted"}`}>
                      {item.ativo ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} {item.ativo ? "Cupom ativo" : "Cupom desativado"}
                    </button>
                    <button type="button" onClick={() => { if (confirm("Remover este cupom?")) setCupons((c) => c.filter((x) => x.id !== item.id)); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 hover:bg-red-950/40"><Trash2 className="w-3.5 h-3.5" /> Remover</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="lg:sticky lg:top-5 space-y-4">
          <section className="rounded-xl border border-line bg-surface p-5">
            <div className="flex items-center gap-2 mb-3 text-orange-400"><Sparkles className="w-4 h-4" /><span className="text-xs font-semibold tracking-normal">Prévia do destaque</span></div>
            {campanhaAtiva ? (
              <div className="relative min-h-[310px] overflow-hidden rounded-xl border border-line bg-canvas">
                {campanhaAtiva.imagem_url && <img src={campanhaAtiva.imagem_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-55" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/65 to-black/10" />
                <div className="relative min-h-[310px] p-5 flex flex-col justify-end">
                  <span className="w-fit px-2.5 py-1 rounded bg-brand-700 text-white text-xs font-semibold tracking-normal">{campanhaAtiva.etiqueta || "OFERTA"}</span>
                  <h3 className="mt-3 text-2xl leading-tight font-semibold text-white">{campanhaAtiva.titulo}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-ink-muted">{campanhaAtiva.subtitulo}</p>
                  <span className="mt-4 w-fit px-4 py-2 rounded-xl bg-brand-700 text-white text-xs font-semibold">{campanhaAtiva.cta_label || "Aproveitar"}</span>
                </div>
              </div>
            ) : (
              <div className="min-h-[260px] rounded-xl border border-dashed border-line bg-surface-muted/40 grid place-items-center text-center p-6">
                <div><Megaphone className="w-8 h-8 text-ink-subtle mx-auto mb-3" /><p className="text-sm font-semibold text-white">Ative um banner</p><p className="text-xs text-ink-muted mt-1">A prévia aparecerá aqui.</p></div>
              </div>
            )}
          </section>
          <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex gap-3"><ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" /><div><strong className="text-xs font-semibold text-white">Desconto protegido</strong><p className="text-xs text-ink-muted leading-relaxed mt-1">O navegador mostra a estimativa, mas o servidor recalcula produtos, adicionais, pedido mínimo, validade e desconto.</p></div></div>
          </section>
        </aside>
      </div>

      <style>{`
        .admin-promo-input {
          width: 100%; min-height: 40px; padding: 8px 12px; border-radius: 10px;
          border: 1px solid var(--color-line); background: var(--color-surface-muted); color: var(--color-ink);
          font-size: 14px; outline: none; transition: border-color .15s;
        }
        .admin-promo-input:focus { border-color: #f97316; }
        .admin-promo-input::placeholder { color: var(--color-ink-subtle); }
      `}</style>
    </div>
  );
}
