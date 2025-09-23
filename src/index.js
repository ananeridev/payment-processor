import { getConfig } from './config.js'
import { buildApp } from './app.js'

function main() {
	const { port } = getConfig()
	const app = buildApp()
	app.listen(port, () => { /* noop */ })
}

main()
