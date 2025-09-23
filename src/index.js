import { buildApp } from './app.js'
import { getConfig } from './config.js'

function main() {
	const { port } = getConfig()
	const app = buildApp()
	app.listen(port, () => { /* noop */ })
}

main()
