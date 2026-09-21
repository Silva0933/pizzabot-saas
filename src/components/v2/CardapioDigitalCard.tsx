import React, { useState } from "react";
import { Store, Globe, Copy, ExternalLink, Check, Pencil, QrCode, AlertCircle, Loader2, Phone } from "lucide-react";
import { BackendPizzaria, pizzariasApi } from "../../lib/api";

interface Props {
  pizzaria: BackendPizzaria;
  onUpdated?: (p: BackendPizzaria) => void;
}

export function CardapioDigitalCard({ pizzaria, onUpdated }: Props) {
  const slug = pizzaria.slug || "";
  const [editing, setEditing] = useState(false);
  const [newSlug, setNewSlug] = useState(slug);
  const [editingPhone, setEditingPhone] = useState(false);
  const [newPhone, setNewPhone] = useState(pizzaria.telefone_contato || "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const link = slug ? `${baseUrl}/m/${slug}` : "";
  const qrUrl = link ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(link)}` : "";
  const zapAtual = pizzaria.telefone_contato || pizzaria.telefone_admin || "";

  function copyLink() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function saveSlug() {
    if (!newSlug.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await pizzariasApi.update(pizzaria.id, { slug: newSlug.trim() } as any);
      onUpdated?.(r);
      setEditing(false);
    } catch (e: any) {
      setErr(e.message || "Erro ao salvar link");
    }
    setSaving(false);
  }

  async function savePhone() {
    setSaving(true);
    setErr(null);
    try {
      const r = await pizzariasApi.update(pizzaria.id, { telefone_contato: newPhone.trim() || null } as any);
      onUpdated?.(r);
      setEditingPhone(false);
    } catch (e: any) {
      setErr(e.message || "Erro ao salvar WhatsApp");
    }
    setSaving(false);
  }

  if (!slug) {
    return (
      <div className="rounded-2xl p-5 border border-dashed border-slate-800 bg-[#161f30]/40 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl grid place-items-center bg-orange-500/10 border border-orange-500/30 text-orange-400 shrink-0">
          <Store className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Cardápio Digital</p>
          <p className="text-xs text-slate-400">Configure o nome da sua pizzaria em Meu Negócio para gerar o link do cardápio público.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-5 border border-orange-900/40 bg-[#111622] shadow-sm space-y-4">
      {/* Topo do card: Identificação e status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl grid place-items-center bg-orange-500/10 border border-orange-500/30 text-orange-400 shrink-0">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">Cardápio Digital</h3>
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                Online
              </span>
            </div>
            <p className="text-xs text-orange-300/80 mt-0.5">Link público oficial para seus clientes fazerem pedidos online</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowQr(!showQr)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#161f30] hover:bg-[#1e293b] border border-[#1e293b] text-slate-300 hover:text-white transition-colors shrink-0"
            title="Ver QR Code do cardápio"
          >
            <QrCode className="w-3.5 h-3.5 text-orange-400" />
            <span>QR Code</span>
          </button>
        </div>
      </div>

      {/* Caixa com o link público e botões de ação rápida */}
      <div className="bg-[#0b0e14] rounded-xl border border-slate-800 p-2.5 sm:p-3 flex flex-col sm:flex-row sm:items-center gap-2.5">
        <div className="flex-1 min-w-0 text-xs font-mono text-slate-300 truncate select-all px-1">
          {link}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={copyLink}
            title="Copiar link"
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500/15 border border-orange-500/30 text-orange-400 hover:bg-orange-500/25 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "Copiado!" : "Copiar"}</span>
          </button>
          <a
            href={`/m/${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors shadow-sm"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Abrir</span>
          </a>
        </div>
      </div>

      {/* Modal/Gaveta do QR Code */}
      {showQr && (
        <div className="p-4 bg-[#0b0e14] border border-orange-500/30 rounded-xl flex flex-col sm:flex-row items-center gap-4 animate-fade-in">
          <div className="bg-white p-2.5 rounded-xl shrink-0 shadow-md">
            <img src={qrUrl} alt="QR Code do Cardápio" className="w-36 h-36 object-contain" />
          </div>
          <div className="space-y-2 text-center sm:text-left flex-1">
            <h4 className="text-xs font-bold text-white">QR Code para mesas, balcão e panfletos</h4>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Imprima este QR Code ou coloque em displays nas mesas. Ao apontar a câmera do celular, o cliente abre o seu cardápio instantaneamente sem precisar instalar aplicativo.
            </p>
            <div className="pt-1 flex gap-2 justify-center sm:justify-start">
              <a
                href={qrUrl}
                download={`qrcode-cardapio-${slug}.png`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#161f30] hover:bg-[#1e293b] border border-[#1e293b] text-slate-200 transition-colors inline-block"
              >
                Baixar imagem do QR Code
              </a>
              <button
                type="button"
                onClick={() => setShowQr(false)}
                className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Configurações inline: Link e WhatsApp do Cardápio */}
      <div className="space-y-2.5 pt-1 border-t border-[#1e293b]/60">
        {/* Linha 1: Edição do slug */}
        {editing ? (
          <div className="space-y-1.5">
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
              <span className="text-xs text-slate-400 font-mono whitespace-nowrap">{baseUrl}/m/</span>
              <input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                className="flex-1 px-3 py-1.5 bg-[#0b0e14] border border-slate-800 text-slate-100 rounded-lg text-xs focus:border-orange-500 outline-none"
                placeholder="minha-pizzaria"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveSlug}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 flex items-center gap-1"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>{saving ? "Salvando..." : "Salvar"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setErr(null); }}
                  className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1.5"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => { setNewSlug(slug); setEditing(true); setErr(null); }}
              className="text-orange-400 hover:text-orange-300 font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              <span>Editar link personalizado</span>
            </button>
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              /m/{slug}
            </span>
          </div>
        )}

        {/* Linha 2: Edição do WhatsApp de atendimento */}
        {editingPhone ? (
          <div className="space-y-1.5">
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
              <span className="text-xs text-slate-400 whitespace-nowrap flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-emerald-400" />
                <span>WhatsApp:</span>
              </span>
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="flex-1 px-3 py-1.5 bg-[#0b0e14] border border-slate-800 text-slate-100 rounded-lg text-xs focus:border-emerald-500 outline-none"
                placeholder="Ex: 11999999999 (ou vazio para ocultar botão)"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={savePhone}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-1"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>{saving ? "Salvando..." : "Salvar"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingPhone(false); setErr(null); }}
                  className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1.5"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => { setNewPhone(pizzaria.telefone_contato || ""); setEditingPhone(true); setErr(null); }}
              className="text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              <span>WhatsApp do Cardápio: <strong>{zapAtual || "Não configurado"}</strong></span>
            </button>
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              Usado no botão "Falar no WhatsApp" do cardápio
            </span>
          </div>
        )}

        {err && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{err}</span>
          </p>
        )}
      </div>
    </div>
  );
}
