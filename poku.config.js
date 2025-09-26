export default {
	// Configuração do Poku para testes unitários
	testMatch: ['tests/unit/**/*.test.js'],
	coverage: {
		enabled: true,
		reporter: ['text', 'html'],
		include: ['src/services/**/*.js'],
		exclude: ['node_modules/**', 'tests/**']
	},
	// Configuração para ES modules
	module: {
		type: 'esm'
	}
}
