/**
 * Adicionais do item que o NOME ainda não mostra.
 *
 * O pedido do cardápio grava o nome sem os adicionais ("Pizza Brasa (G)") e a
 * lista à parte; o do WhatsApp grava o nome já com eles ("Pizza Brasa (G) +
 * Queijo extra") e, desde 01/10, também a lista (para o "pedir de novo"). Sem
 * este filtro o adicional apareceria duas vezes no painel.
 */
export function adicionaisForaDoNome(item: { nome?: string | null; adicionais?: unknown }): string[] {
  const lista = Array.isArray(item.adicionais) ? item.adicionais : [];
  const nome = norm(item.nome || "");
  return lista
    .map((a) => (typeof a === "string" ? a : String((a as { nome?: string })?.nome || "")))
    .filter((a) => a && !nome.includes(norm(a)));
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
