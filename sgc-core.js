(function (root) {
  const PARAMETROS_SGC = {
    dias_producao: 7,
    lead_time: 3,
    cobertura_minima: 10,
    limite_excesso: 20,
  };

  function getParametrosSgc() {
    return PARAMETROS_SGC;
  }

  function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function calcularConsumoSemanal(consumoMensal) {
    return Number((toNumber(consumoMensal) / 4.3333).toFixed(2));
  }

  function calcularConsumoDiario(consumoMensal) {
    return Number((toNumber(consumoMensal) / 30).toFixed(2));
  }

  function calcularEstoqueSeguranca(consumoDiario, prazoEntrega = getParametrosSgc().lead_time, margemSeguranca = 0.2) {
    return Math.ceil(toNumber(consumoDiario) * toNumber(prazoEntrega) * (1 + toNumber(margemSeguranca)));
  }

  function calcularCoberturaDias(estoqueDisponivel, consumoDiario) {
    const consumo = toNumber(consumoDiario);
    if (consumo === 0) return Infinity;
    return Number((toNumber(estoqueDisponivel) / consumo).toFixed(1));
  }

  function calcularPontoPedido(consumoDiario, prazoEntrega = getParametrosSgc().lead_time) {
    return Math.ceil(toNumber(consumoDiario) * toNumber(prazoEntrega));
  }

  function calcularNecessidade7Dias(consumoDiario) {
    return Number((toNumber(consumoDiario) * getParametrosSgc().dias_producao).toFixed(2));
  }

  function calcularNecessidadeLeadTime(consumoDiario) {
    return Number((toNumber(consumoDiario) * getParametrosSgc().lead_time).toFixed(2));
  }

  function calcularNecessidadeTotal(consumoDiario) {
    const parametros = getParametrosSgc();
    return Number((toNumber(consumoDiario) * (parametros.dias_producao + parametros.lead_time)).toFixed(2));
  }

  function calcularRecebimentoPendente(produtoId, pedidosCompra = null, itensPedido = null) {
    const pedidos = Array.isArray(pedidosCompra) ? pedidosCompra : [];
    const itens = Array.isArray(itensPedido) ? itensPedido : [];
    const statusPermitidos = ['PENDENTE', 'APROVADO', 'PARCIALMENTE_RECEBIDO'];

    return itens.reduce((total, item) => {
      const pedido = pedidos.find(p => String(p.id) === String(item.pedido_id));
      if (!pedido) return total;
      if (String(item.produto_id) !== String(produtoId)) return total;
      if (!statusPermitidos.includes(String(pedido.status || '').toUpperCase())) return total;
      const saldoPendente = Math.max(0, toNumber(item.quantidade) - toNumber(item.recebido));
      return total + saldoPendente;
    }, 0);
  }

  function calcularQuantidadeSugerida(consumoDiario, estoqueDisponivel, recebendo, recebimentoPendente = 0) {
    const necessidadeTotal = calcularNecessidadeTotal(consumoDiario);
    const estoqueProjetado = toNumber(estoqueDisponivel) + toNumber(recebimentoPendente || recebendo || 0);
    const quantidade = necessidadeTotal - estoqueProjetado;
    return Math.max(0, Math.ceil(quantidade));
  }

  function calcularStatusCompra(coberturaDiasOrItem, estoqueDisponivel = 0, consumoMensal = 0) {
    const parametros = getParametrosSgc();
    let coberturaDias = coberturaDiasOrItem;
    let estoque = estoqueDisponivel;
    let consumo = consumoMensal;

    if (typeof coberturaDiasOrItem === 'object' && coberturaDiasOrItem !== null) {
      const item = coberturaDiasOrItem;
      consumo = toNumber(item.consumo_medio_mensal || item.consumoMensal || item.consumo_mensal || 0);
      estoque = toNumber(item.estoque_atual || item.estoqueDisponivel || item.estoque || 0) + toNumber(item.recebimento_pendente || item.recebendo || 0);
      coberturaDias = calcularCoberturaDias(estoque, calcularConsumoDiario(consumo));
    }

    if (consumo === 0 && estoque === 0) return 'SEM HISTÓRICO';
    if (consumo === 0 && estoque > 0) return 'MONITORAR';
    if (coberturaDias < 3) return 'URGENTE';
    if (coberturaDias < parametros.cobertura_minima) return 'ATENÇÃO';
    if (coberturaDias > parametros.limite_excesso) return 'EXCESSO';
    return 'NORMAL';
  }

  function calcularStatusBadge(status) {
    switch (status) {
      case 'URGENTE': return 'badge-vermelho';
      case 'ATENÇÃO': return 'badge-amarelo';
      case 'EXCESSO': return 'badge bg-warning text-dark';
      case 'MONITORAR':
      case 'SEM HISTÓRICO': return 'badge bg-secondary';
      default: return 'badge-verde';
    }
  }

  function parsePlanilhaRows(rows) {
    const produtos = [];
    const normalizedRows = rows || [];

    for (let i = 0; i < normalizedRows.length; i += 1) {
      const row = normalizedRows[i] || [];
      const firstCell = row[0];
      if (typeof firstCell !== 'string') continue;
      if (!/código\(s\)\s*:/i.test(firstCell)) continue;

      const codigoMatch = firstCell.match(/código\(s\)\s*:\s*(.*)/i);
      const codigo = codigoMatch ? codigoMatch[1].trim() : '';
      const descricao = (firstCell.split('|')[0] || '').trim();

      let saldoInicial = toNumber(row[33] || row[32] || row[25] || 0);
      let disponivel = 0;
      let recebendo = 0;
      let avariado = 0;
      let mediaMes = 0;
      let saldoFinal = 0;

      for (let j = i + 1; j < normalizedRows.length && j < i + 12; j += 1) {
        const candidate = normalizedRows[j] || [];
        const joined = candidate.join(' ');

        if (/em compras/i.test(joined)) {
          recebendo = toNumber(candidate[5] || candidate[6] || candidate[7] || 0);
        }
        if (/recebendo/i.test(joined)) {
          recebendo = toNumber(candidate[9] || candidate[10] || candidate[8] || 0);
        }
        if (/disponivel/i.test(joined)) {
          disponivel = toNumber(candidate[17] || candidate[18] || candidate[16] || 0);
        }
        if (/média mês|media/i.test(joined)) {
          mediaMes = toNumber(candidate[24] || candidate[25] || candidate[23] || 0);
        }
        if (/saldo/i.test(joined) && !/saldo inicial/i.test(joined)) {
          saldoFinal = toNumber(candidate[33] || candidate[34] || candidate[32] || 0);
        }
      }

      if (descricao) {
        produtos.push(normalizeImportedProduct({
          codigo,
          descricao,
          saldo_inicial: saldoInicial,
          disponivel,
          recebendo,
          avariado,
          saldo_final: saldoFinal,
          consumo_medio_mensal: mediaMes,
          estoque_atual: disponivel,
        }));
      }
    }

    return produtos;
  }

  function normalizeImportedProduct(item) {
    const consumoMensal = toNumber(item.consumo_medio_mensal);
    const consumoDiario = calcularConsumoDiario(consumoMensal);
    const estoqueDisponivel = toNumber(item.estoque_atual || item.disponivel || 0);
    const recebendo = toNumber(item.recebendo || 0);
    const recebimentoPendente = toNumber(item.recebimento_pendente || 0);
    const necessidadeTotal = calcularNecessidadeTotal(consumoDiario);
    const quantidadeSugerida = calcularQuantidadeSugerida(consumoDiario, estoqueDisponivel, recebendo, recebimentoPendente);
    const estoqueProjetado = estoqueDisponivel + recebimentoPendente;
    const coberturaDias = calcularCoberturaDias(estoqueProjetado, consumoDiario);
    const statusCompra = calcularStatusCompra({ consumo_medio_mensal: consumoMensal, estoque_atual: estoqueDisponivel, recebimento_pendente: recebimentoPendente });

    return {
      codigo: item.codigo || '',
      descricao: item.descricao || '',
      categoria: item.categoria || '',
      unidade: item.unidade || '',
      estoque_atual: estoqueDisponivel,
      consumo_medio_mensal: consumoMensal,
      saldo_inicial: toNumber(item.saldo_inicial || 0),
      recebendo: recebendo,
      recebimento_pendente: recebimentoPendente,
      estoque_projetado: estoqueProjetado,
      avariado: toNumber(item.avariado || 0),
      saldo_final: toNumber(item.saldo_final || 0),
      fornecedor_id: item.fornecedor_id || null,
      ultimo_preco: toNumber(item.ultimo_preco || 0),
      data_ultima_compra: item.data_ultima_compra || null,
      tipo_compra: item.tipo_compra || 'Produção normal',
      estoque_segurança: calcularEstoqueSeguranca(consumoDiario),
      ponto_pedido: calcularPontoPedido(consumoDiario),
      necessidade_7_dias: calcularNecessidade7Dias(consumoDiario),
      necessidade_lead_time: calcularNecessidadeLeadTime(consumoDiario),
      necessidade_total: necessidadeTotal,
      quantidade_sugerida: quantidadeSugerida,
      cobertura_dias: coberturaDias,
      status_compra: statusCompra,
    };
  }

  function calcularResumoProduto(produto) {
    const consumoDiario = calcularConsumoDiario(produto.consumo_medio_mensal || 0);
    const estoqueDisponivel = toNumber(produto.estoque_atual || 0);
    const recebendo = toNumber(produto.recebendo || 0);
    const recebimentoPendente = toNumber(produto.recebimento_pendente || 0);
    const estoqueProjetado = estoqueDisponivel + recebimentoPendente;
    const coberturaDias = calcularCoberturaDias(estoqueProjetado, consumoDiario);
    const pontoPedido = calcularPontoPedido(consumoDiario);
    const necessidadeTotal = calcularNecessidadeTotal(consumoDiario);
    const quantidadeSugerida = calcularQuantidadeSugerida(consumoDiario, estoqueDisponivel, recebendo, recebimentoPendente);
    return {
      consumoDiario,
      estoqueSeguranca: calcularEstoqueSeguranca(consumoDiario),
      coberturaDias,
      pontoPedido,
      necessidadeTotal,
      quantidadeSugerida,
      estoqueProjetado,
      statusCompra: calcularStatusCompra({ consumo_medio_mensal: produto.consumo_medio_mensal || 0, estoque_atual: estoqueDisponivel, recebimento_pendente: recebimentoPendente }),
    };
  }

  const API = {
    PARAMETROS_SGC,
    getParametrosSgc,
    calcularConsumoSemanal,
    calcularConsumoDiario,
    calcularEstoqueSeguranca,
    calcularCoberturaDias,
    calcularPontoPedido,
    calcularNecessidade7Dias,
    calcularNecessidadeLeadTime,
    calcularNecessidadeTotal,
    calcularRecebimentoPendente,
    calcularQuantidadeSugerida,
    calcularStatusCompra,
    calcularStatusBadge,
    parsePlanilhaRows,
    normalizeImportedProduct,
    calcularResumoProduto,
    TIPOS_COMPRA: ['Produção normal', 'Campanha', 'Estoque', 'Emergencial'],
  };

  root.SGC = API;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
})(typeof window !== 'undefined' ? window : globalThis);
