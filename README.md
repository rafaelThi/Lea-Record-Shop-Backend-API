# Lea Record Shop - Backend API

Backend de e-commerce para a loja de discos Lea Record Shop. Solucao projetada para gerenciar catalogo de discos, clientes e pedidos, com suporte a alta concorrencia em cenarios de lancamentos exclusivos.

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                  Presentation Layer                  │
│           Controllers + DTOs + Validation            │
├─────────────────────────────────────────────────────┤
│                  Application Layer                   │
│                Services (Use Cases)                  │
├─────────────────────────────────────────────────────┤
│                    Domain Layer                      │
│              Entities + Enums + Types                │
├─────────────────────────────────────────────────────┤
│                Infrastructure Layer                  │
│          TypeORM + Redis + BullMQ + Docker           │
└─────────────────────────────────────────────────────┘
```

### Fluxo de Alta Concorrencia (Lancamento de Disco)

```
Request ──► Controller ──► [Redis DECR] ──► [BullMQ Queue] ──► [Postgres TX]
                             │                  │                    │
                        Resposta <5ms      Processamento      Pessimistic Lock
                             │              Assincrono         + CHECK >= 0
                             │                  │                    │
                        Estoque OK?         Job com retry      UPDATE + COMMIT
                        Nao → 409           (3 tentativas)
```

**3 camadas de protecao contra oversell:**
1. **Redis DECR atomico**: Gate de estoque com resposta em sub-milissegundo
2. **BullMQ**: Fila para processamento assincrono com retry automatico
3. **PostgreSQL**: Pessimistic lock + CHECK constraint `quantity >= 0`

## Tech Stack

| Tecnologia | Por que foi escolhida |
|---|---|
| Node.js + TypeScript | Linguagem indicada pelo contexto da empresa. O event-loop nao-bloqueante do Node e ideal para cenarios de alta concorrencia com I/O (50 req/s disputando estoque). TypeScript adiciona seguranca de tipos e previne bugs em tempo de desenvolvimento. |
| NestJS | Framework mais maduro do ecossistema Node.js. Escolhido por ja implementar Clean Architecture (modules, decorators) sem necessidade de montar manualmente. Alternativa seria Express puro, mas exigiria mais sem ganho real. |
| PostgreSQL 16 | Banco relacional robusto com suporte nativo a transacoes ACID, `SELECT FOR UPDATE` (pessimistic locking) e CHECK constraints - fundamentais para o cenario de controle de estoque concorrente. Escolhido sobre MySQL por melhor suporte a locking e sobre MongoDB por necessidade de transacoes e relacionamentos. |
| Redis 7 | Banco em memoria com operacoes atomicas (DECRBY) em sub-milissegundo. Escolhido para ser o gate de estoque em alta concorrencia - o single-thread do Redis garante atomicidade sem locks explicitos. Tambem serve como backend para o BullMQ. |
| BullMQ | Fila de processamento assincrono com retry automatico e backoff exponencial. Escolhido sobre RabbitMQ/SQS por reutilizar o Redis ja existente (zero infraestrutura extra). Permite desacoplar a resposta rapida ao usuario da persistencia no banco. |
| TypeORM | ORM com suporte nativo a decorators (combina com NestJS), migrations, query builder e pessimistic locking. Escolhido por integrar-se naturalmente ao ecossistema NestJS. |
| Docker | Requisito do desafio. Permite executar toda a stack (app + Postgres + Redis) com um unico comando, garantindo ambiente identico em qualquer maquina. |

## Como Executar

### Pre-requisitos
- Docker e Docker Compose instalados
- Node.js 20+ (para desenvolvimento local e testes - o projeto inclui `.nvmrc`)

### Subir toda a stack

```bash
docker compose up --build
```

A API estara disponivel em `http://localhost:3000`.

### Desenvolvimento local (sem Docker para a app)

```bash
# Subir apenas Postgres e Redis
docker compose up postgres redis -d

# Instalar dependencias
npm install

# Rodar em modo desenvolvimento
npm run start:dev
```

### Variaveis de Ambiente

| Variavel | Default | Descricao |
|---|---|---|
| `DATABASE_HOST` | localhost | Host do PostgreSQL |
| `DATABASE_PORT` | 5432 | Porta do PostgreSQL |
| `DATABASE_USERNAME` | lea | Usuario do banco |
| `DATABASE_PASSWORD` | lea | Senha do banco |
| `DATABASE_NAME` | lea_records | Nome do banco |
| `REDIS_HOST` | localhost | Host do Redis |
| `REDIS_PORT` | 6379 | Porta do Redis |
| `PORT` | 3000 | Porta da aplicacao |

## API Endpoints

### Discos

```bash
# Criar disco
curl -X POST http://localhost:3000/discs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "We are Reactive",
    "artist": "Hohpe",
    "releaseYear": 2026,
    "style": "Indie",
    "quantity": 500
  }'

# Listar com filtros
curl "http://localhost:3000/discs?style=Indie&artist=Hohpe&page=1&limit=10"

# Buscar por ID
curl http://localhost:3000/discs/{id}

# Verificar estoque (tempo real via Redis)
curl http://localhost:3000/discs/{id}/stock

# Atualizar
curl -X PUT http://localhost:3000/discs/{id} \
  -H "Content-Type: application/json" \
  -d '{"quantity": 1000}'

# Remover
curl -X DELETE http://localhost:3000/discs/{id}
```

### Clientes

```bash
# Cadastrar
curl -X POST http://localhost:3000/customers \
  -H "Content-Type: application/json" \
  -d '{
    "document": "12345678901",
    "fullName": "Maria Silva",
    "birthDate": "1990-05-20",
    "email": "maria@email.com",
    "phone": "11999999999"
  }'

# Buscar por ID
curl http://localhost:3000/customers/{id}

# Atualizar
curl -X PUT http://localhost:3000/customers/{id} \
  -H "Content-Type: application/json" \
  -d '{"fullName": "Maria Santos Silva"}'

# Inativar
curl -X PATCH http://localhost:3000/customers/{id}/inactivate

# Reativar
curl -X PATCH http://localhost:3000/customers/{id}/activate
```

### Pedidos

```bash
# Criar pedido (retorna 202 Accepted)
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "{customer-id}",
    "items": [
      {"discId": "{disc-id}", "quantity": 1}
    ]
  }'

# Listar com filtros
curl "http://localhost:3000/orders?customerId={id}&startDate=2026-01-01&endDate=2026-12-31"

# Buscar por ID
curl http://localhost:3000/orders/{id}
```

## Testes

```bash
# Testes unitarios (21 testes - nao requer infraestrutura rodando)
npm test

# Simulacao de lancamento com alta concorrencia (requer Docker rodando)
# Cria 500 discos, 600 clientes e dispara 600 compras simultaneas
# Valida que nao houve oversell e que o estoque nunca ficou negativo
npm run test:launch

# Coverage
npm run test:cov
```

### Dependencias para testes

- **Testes unitarios (`npm test`)**: Apenas `npm install`. Usam mocks e nao dependem de banco ou Redis.
- **Simulacao de lancamento (`npm run test:launch`)**: Requer a stack rodando (`docker compose up --build`).

## Estrutura do Projeto

```
src/
├── main.ts                          # Bootstrap da aplicacao
├── app.module.ts                    # Modulo raiz
├── common/
│   ├── filters/                     # Exception filters
│   └── redis.provider.ts            # Provider do Redis
├── config/
│   ├── database.config.ts           # Configuracao PostgreSQL
│   └── redis.config.ts              # Configuracao Redis
└── modules/
    ├── disc/
    │   ├── disc.controller.ts       # CRUD endpoints
    │   ├── disc.service.ts          # Logica de negocio + sync Redis
    │   ├── disc.module.ts
    │   ├── entities/disc.entity.ts  # Entity com CHECK constraint
    │   ├── dto/                     # Create, Update, Filter DTOs
    │   └── enums/disc-style.enum.ts
    ├── customer/
    │   ├── customer.controller.ts   # Cadastro + inativacao
    │   ├── customer.service.ts      # Validacao de cliente ativo
    │   ├── customer.module.ts
    │   ├── entities/
    │   └── dto/
    └── order/
        ├── order.controller.ts      # POST retorna 202 Accepted
        ├── order.service.ts         # Redis gate + enfileiramento
        ├── order.processor.ts       # BullMQ worker + pessimistic lock
        ├── order.module.ts
        ├── entities/
        │   ├── order.entity.ts
        │   └── order-item.entity.ts
        └── dto/
```

## Decisoes Arquiteturais (ADRs)

### ADR-001: Redis DECRBY como gate de estoque

**Contexto**: Cenario de lancamento com 50 req/s competindo por 500 unidades.

**Decisao**: Usar Redis `DECRBY` atomico como primeira camada de validacao de estoque, antes de qualquer acesso ao banco de dados.

**Motivo**: O `DECRBY` do Redis e single-threaded e atomico. Com 50 req/s, cada operacao leva microsegundos. Quem nao consegue comprar recebe 409 em menos de 5ms, sem tocar no banco.

### ADR-002: Processamento assincrono com BullMQ

**Contexto**: Apos a reserva no Redis, o pedido precisa ser persistido no PostgreSQL.

**Decisao**: Retornar HTTP 202 imediatamente e processar o pedido via fila BullMQ.

**Motivo**: Desacopla a resposta rapida ao usuario da persistencia no banco. O worker processa com pessimistic lock e retry automatico (3 tentativas com backoff exponencial). Se falhar, o estoque e devolvido ao Redis.

### ADR-003: CHECK constraint como ultima barreira

**Contexto**: Redis pode dessincronizar do banco em cenarios de falha.

**Decisao**: Manter `CHECK (quantity >= 0)` na tabela `discs`.

**Motivo**:  Mesmo que Redis falhe ou dessincronize, o banco nunca permite estoque negativo. A transacao simplesmente falha e o BullMQ faz retry ou marca o pedido como FAILED.

### ADR-004: Fallback para PostgreSQL se Redis cair

**Contexto**: Redis pode ficar indisponivel temporariamente.

**Decisao**: Se o `DECRBY` falhar por erro de conexao, fallback para `UPDATE discs SET quantity = quantity - N WHERE quantity >= N` com lock no Postgres.

**Motivo**: Graceful degradation. A performance sera menor, mas o sistema continua operando. Melhor do que rejeitar todas as compras.

## Arquitetura AWS (Producao)

```
                    ┌──────────────┐
                    │   Route 53   │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │     ALB      │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼──┐   ┌────▼───┐  ┌────▼───┐
        │  ECS   │   │  ECS   │  │  ECS   │
        │Fargate │   │Fargate │  │Fargate │
        └────┬───┘   └────┬───┘  └────┬───┘
             └─────────────┼──────────┘
                     ┌─────┼─────┐
                     │           │
              ┌──────▼──┐  ┌────▼──────┐
              │   RDS   │  │ElastiCache│
              │Postgres │  │   Redis   │
              │Multi-AZ │  │  Cluster  │
              └─────────┘  └───────────┘
```

- **ECS Fargate**: Auto-scaling por CPU/memoria e request count
- **RDS Multi-AZ**: Alta disponibilidade para PostgreSQL
- **ElastiCache**: Redis gerenciado com failover automatico
- **ALB**: Load balancer com health checks

## Licenca

MIT
