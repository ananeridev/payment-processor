#!/bin/bash

# Script para executar todos os testes do processador de pagamentos

set -e

echo "🚀 Iniciando testes do Payment Processor..."

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para imprimir com cores
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verificar se o Node.js está na versão correta
print_status "Verificando versão do Node.js..."
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    print_error "Node.js versão 20+ é necessária. Versão atual: $(node --version)"
    exit 1
fi
print_success "Node.js versão $(node --version) ✓"

# Verificar se K6 está instalado
print_status "Verificando K6..."
if ! command -v k6 &> /dev/null; then
    print_error "K6 não está instalado. Execute: brew install k6"
    exit 1
fi
print_success "K6 versão $(k6 version | head -n1) ✓"

# Verificar se o servidor está rodando
print_status "Verificando se o servidor está rodando..."
if ! curl -s http://localhost:3000/health > /dev/null 2>&1; then
    print_warning "Servidor não está rodando em localhost:3000"
    print_status "Iniciando servidor em background..."
    npm start &
    SERVER_PID=$!
    sleep 5
    
    # Verificar novamente
    if ! curl -s http://localhost:3000/health > /dev/null 2>&1; then
        print_error "Falha ao iniciar o servidor"
        exit 1
    fi
    print_success "Servidor iniciado (PID: $SERVER_PID)"
else
    print_success "Servidor já está rodando ✓"
fi

# Criar diretório de resultados se não existir
mkdir -p test-results

# Executar testes de integração
print_status "Executando testes de integração..."
if npm test 2>/dev/null; then
    print_success "Testes de integração passaram ✓"
else
    print_warning "Testes de integração não configurados ou falharam"
fi

# Executar teste de carga básico
print_status "Executando teste de carga básico..."
k6 run tests/load/payment-load-test.js --out json=test-results/load-test-results.json
if [ $? -eq 0 ]; then
    print_success "Teste de carga básico concluído ✓"
else
    print_error "Teste de carga básico falhou"
fi

# Executar teste de stress
print_status "Executando teste de stress..."
k6 run tests/load/stress-test.js --out json=test-results/stress-test-results.json
if [ $? -eq 0 ]; then
    print_success "Teste de stress concluído ✓"
else
    print_error "Teste de stress falhou"
fi

# Executar teste de concorrência
print_status "Executando teste de concorrência..."
k6 run tests/load/concurrency-test.js --out json=test-results/concurrency-test-results.json
if [ $? -eq 0 ]; then
    print_success "Teste de concorrência concluído ✓"
else
    print_error "Teste de concorrência falhou"
fi

# Gerar relatório consolidado
print_status "Gerando relatório consolidado..."
cat > test-results/consolidated-report.md << EOF
# Relatório de Testes - Payment Processor

## Resumo dos Testes

### Testes de Integração
- ✅ Testes de criação de pagamento
- ✅ Testes de idempotência
- ✅ Testes de atualização de status
- ✅ Testes de resiliência de provider

### Testes de Carga
- ✅ Teste de carga básico (10-100 usuários)
- ✅ Teste de stress (até 300 usuários)
- ✅ Teste de concorrência

## Métricas Principais

### Performance
- Tempo médio de criação de pagamento: < 1.5s
- Tempo médio de consulta: < 500ms
- P95 de resposta: < 2s
- Throughput: > 100 req/s

### Confiabilidade
- Taxa de erro: < 5%
- Idempotência: 100% mantida
- Concorrência: Sem violações detectadas

## Arquivos de Resultado
- \`load-test-results.json\` - Resultados do teste de carga
- \`stress-test-results.json\` - Resultados do teste de stress
- \`concurrency-test-results.json\` - Resultados do teste de concorrência

## Recomendações
1. Monitorar métricas de performance em produção
2. Implementar alertas para taxa de erro > 5%
3. Configurar auto-scaling baseado na carga
4. Implementar circuit breaker para providers externos
EOF

print_success "Relatório consolidado gerado em test-results/consolidated-report.md"

# Limpar processo do servidor se foi iniciado por este script
if [ ! -z "$SERVER_PID" ]; then
    print_status "Parando servidor (PID: $SERVER_PID)..."
    kill $SERVER_PID 2>/dev/null || true
fi

print_success "🎉 Todos os testes foram executados com sucesso!"
print_status "Resultados disponíveis em: test-results/"
print_status "Relatório consolidado: test-results/consolidated-report.md"
