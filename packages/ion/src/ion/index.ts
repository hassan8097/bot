import { TelegramClient } from 'telegram'
import { Logger } from 'telegram'
import { NewMessage, NewMessageEvent } from 'telegram/events'
import logger from '../logger'
import { GetConfig, SetConfig } from '../providers/config'
import { getUserCreds } from '../utils/getUserCred'
import allModules, { Meta } from './modules'

const { version } = require('../../package.json')
const { NODE_ENV } = process.env
const defaultPrefixe = '.'

if (NODE_ENV !== 'dev') {
	Logger.setLevel('none')
}

class Ion {
	client?: TelegramClient
	private prefix: string = defaultPrefixe

	loadedModules: Meta[] = []
	isRunning: Boolean = false

	match(event: NewMessageEvent, commands: string | string[]): boolean {
		const message = event.message.message

		if (!message) {
			return false
		}

		commands = Array.isArray(commands) ? commands : [commands]

		const prefix = this.prefix

		if (message.startsWith(prefix)) {
			for (let k in commands) {
				const command = commands[k]
				const withoutPrefix = message.slice(1, message.length)

				if (withoutPrefix.match(new RegExp(`^(?:${command})(?:\\s|$)`))) {
					return true
				}
			}
		}

		return false
	}

	async init() {
		const { apiId, apiHash, session } = await getUserCreds()
		if (apiId && apiHash && session) {
			this.client = new TelegramClient(session, apiId, apiHash, {
				connectionRetries: 5,
			})

			logger.info(`initialising ion ${version}`)

			// start bot
			await this.client.start({ botAuthToken: '' })
			this.isRunning = true

			allModules.map((module) => {
				const { meta, handlers } = module
				this.loadedModules.push(meta)

				handlers.forEach(({ handler, params }) => {
					params.mode = params.mode || 'outgoing'
					params.scope = params.scope || 'all'

					const mode = {
						outgoing: params.mode === 'outgoing',
						icoming: params.mode === 'incoming',
					}

					this.client?.addEventHandler(
						async (event: NewMessageEvent) => {
							// attach handler to the module
							let match: any = ''

							if (params.pattern) {
								match = event.message.message?.match(params.pattern)
							}

							const moduleConfig = await GetConfig(`mod-${meta.id}`)

							handler(this.client as TelegramClient, event, {
								config: moduleConfig || {},
								match,
								saveConf: async (key: string, value: any) => {
									// module config
									const _config = await GetConfig(`mod-${meta.id}`)
									_config[key] = value
									await SetConfig(`mod-${meta.id}`, _config)
								},
							})
						},
						new NewMessage({
							...mode,
							func: (event) => {
								// validate conditions
								let match = false,
									isValidScope = false

								if (params.pattern) {
									match = Boolean(event.message.message?.match(params.pattern))
								} else if (params.commands) {
									match = this.match(event, params.commands)
								}

								const scopes = Array.isArray(params.scope)
									? params.scope
									: [params.scope]

								if (scopes.includes('all')) {
									isValidScope = true
								} else {
									if (
										(event.isGroup && scopes.includes('group')) ||
										(event.isPrivate && scopes.includes('private')) ||
										(event.isChannel && scopes.includes('channel'))
									) {
										isValidScope = true
									}
								}

								return match && isValidScope
							},
						})
					)
				})
			})
		}
	}

	async getProfile() {
		if (!this.client || !this.isRunning) {
			throw new Error('ION_NOT_SETUP')
		}
		const profile = await this.client?.getMe()
		return profile
	}

	async getLoadedModules() {
		return this.loadedModules
	}
}

export { Ion }
