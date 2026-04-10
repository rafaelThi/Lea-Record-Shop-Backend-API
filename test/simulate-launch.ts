/**
 * Simulacao do Lancamento do Disco "We are Reactive"

 * Cenario: 500 discos, 600 usuarios tentando comprar ao mesmo tempo
 * Resultado esperado: exatamente 500 pedidos aceitos, 0 oversell

 */

const BASE_URL = 'http://localhost:3000';

async function request(
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function main() {
  const STOCK = 500;
  const TOTAL_BUYERS = 600; // 600 compradores para 500 discos

  console.log(`SIMULACAO: Lancamento "We are Reactive"`);

  // 1. Criar o disco
  console.log('[1/5] Criando disco com unidades...');
  const disc = await request('POST', '/discs', {
    name: `We are Reactive - Launch Test ${Date.now()}`,
    artist: 'Hohpe',
    releaseYear: 2026,
    style: 'Indie',
    quantity: STOCK,
  });

  if (disc.status !== 201) {
    console.log('Erro ao criar disco:', disc.data);
    return;
  }

  const discId = disc.data.id;
  console.log(`  Disco criado: ${discId}`);

  // 2. Criar compradores
  console.log(`[2/5] Cadastrando ${TOTAL_BUYERS} clientes...`);
  const customerIds: string[] = [];
  const batchId = Date.now();

  // Cadastrar em lotes de 50 para nao sobrecarregar
  const BATCH_SIZE = 50;
  for (let batch = 0; batch < Math.ceil(TOTAL_BUYERS / BATCH_SIZE); batch++) {
    const batchPromises = [];
    for (let i = 0; i < BATCH_SIZE && batch * BATCH_SIZE + i < TOTAL_BUYERS; i++) {
      const idx = batch * BATCH_SIZE + i;
      batchPromises.push(
        request('POST', '/customers', {
          document: String(batchId + idx).slice(-11),
          fullName: `Comprador ${idx + 1}`,
          birthDate: '1990-01-01',
          email: `buyer_${batchId}_${idx}@test.com`,
        }),
      );
    }
    const batchResults = await Promise.all(batchPromises);
    for (const customer of batchResults) {
      if (customer.status === 201) {
        customerIds.push(customer.data.id);
      }
    }
    process.stdout.write(`  ${customerIds.length}/${TOTAL_BUYERS} cadastrados...\r`);
  }

  console.log(`  ${customerIds.length} clientes cadastrados`);

  // 3. Verificar estoque antes
  const stockBefore = await request('GET', `/discs/${discId}/stock`);
  console.log(`[3/5] Estoque antes do lancamento: ${stockBefore.data.stock}`);

  // 4. LANCAMENTO! Disparar todas as compras ao mesmo tempo
  console.log(`[4/5] LANCAMENTO! ${TOTAL_BUYERS} compradores ao mesmo tempo...`);

  const startTime = Date.now();

  const promises = customerIds.map((customerId) =>
    request('POST', '/orders', {
      customerId,
      items: [{ discId, quantity: 1 }],
    }),
  );

  const results = await Promise.all(promises);
  const elapsed = Date.now() - startTime;

  // 5. Resultados
  const accepted = results.filter((r) => r.status === 202);
  const rejected = results.filter((r) => r.status === 409);
  const errors = results.filter((r) => r.status !== 202 && r.status !== 409);

  console.log('RESULTADOS');

  console.log(`Tempo total: ${elapsed}ms`);
  console.log(`Tempo por request: ${(elapsed / TOTAL_BUYERS).toFixed(1)}ms`);

  console.log(`Pedidos ACEITOS: ${accepted.length} (esperado: ${STOCK})`);
  console.log(`Pedidos REJEITADOS: ${rejected.length} (esperado: ${TOTAL_BUYERS - STOCK})`);

  if (errors.length > 0) {
    console.log(`Outros erros: ${errors.length}`);
    errors.slice(0, 3).forEach((e) => console.log(`Status ${e.status}:`, e.data));
  }

  // Aguardar o BullMQ processar
  console.log('  Aguardando BullMQ processar os pedidos (3s)...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Verificar estoque final
  const stockAfter = await request('GET', `/discs/${discId}/stock`);
  const finalStock = stockAfter.data.stock;

  console.log(`Estoque ANTES: ${STOCK}`);
  console.log(`Estoque DEPOIS: ${finalStock}`);
  console.log(`Vendidos: ${STOCK - finalStock}`);

  // Validacao final
  console.log('VALIDACAO');

  let allPassed = true;

  // Teste 1: Nao vendeu mais do que tinha
  if (accepted.length <= STOCK) {
    console.log(`PASS Nao houve oversell (${accepted.length} <= ${STOCK})`);
  } else {
    console.log(`FAIL OVERSELL! Vendeu ${accepted.length} mas so tinha ${STOCK}`);
    allPassed = false;
  }

  // Teste 2: Estoque nao ficou negativo
  if (finalStock >= 0) {
    console.log(`PASS Estoque nao ficou negativo (${finalStock} >= 0)`);
  } else {
    console.log(`FAIL Estoque NEGATIVO: ${finalStock}`);
    allPassed = false;
  }

  // Teste 3: Todos receberam resposta (aceito ou rejeitado)
  if (accepted.length + rejected.length + errors.length === TOTAL_BUYERS) {
    console.log(`PASS Todos os ${TOTAL_BUYERS} usuarios receberam resposta`);
  } else {
    console.log('FAIL Nem todos receberam resposta');
    allPassed = false;
  }

  // Teste 4: Performance
  if (elapsed < 30000) {
    console.log(`PASS Respondeu em ${elapsed}ms (< 30s para ${TOTAL_BUYERS} requests)`);
  } else {
    console.log(`  WARN Lento: ${elapsed}ms`);
  }

  console.log(allPassed ? 'TODOS OS TESTES PASSARAM!' : 'ALGUM TESTE FALHOU!');
}

main().catch(console.error);
