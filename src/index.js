const { Client, Collection } = require('discord.js')
const { readdirSync, readFileSync } = require('fs')
const { join } = require('path')
const { createLogger, transports, format } = require('winston')
const { prefix, defaultCooldown } = require('../config.json')

// Set up logging
const logger = createLogger({
  level: 'debug',
  format: format.errors(),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
    new transports.File({
      level: 'info',
      filename: 'discordbot.log',
      format: format.json(),
      handleExceptions: true
    })
  ]
})

// Load secrets from file, then overlay with environment variables
let secrets = {}
try {
  const secretsPath = require.resolve(join('..', 'secrets.json'))
  var secretsFileJson = readFileSync(secretsPath, { encoding: 'utf8' })
  secrets = JSON.parse(secretsFileJson)
} catch (e) {
  logger.info('Failed to read secrets.json.')
}
secrets = {
  ...secrets,
  ...(process.env.TOKEN && { token: process.env.TOKEN }),
  ...(process.env.MINECRAFT_SERVER_FUNCTION_CODE && { minecraftServerFuncsCode: process.env.MINECRAFT_SERVER_FUNCTION_CODE })
}

// Set up client
const client = new Client()

// Set up client logging
client.on('ready', () => logger.info('The bot is online!'))
client.on('debug', (message) => logger.debug(message))
client.on('warn', (message) => logger.warn(message))
client.on('error', (message) => logger.error(message))

// Discover all the commands
client.commands = new Collection()
const commandDir = join(__dirname, 'commands')
const commandFiles = readdirSync(commandDir).filter((f) => f.endsWith('.js'))
commandFiles.forEach((file) => {
  const commandPath = join(commandDir, file)
  const command = require(commandPath)
  client.commands.set(command.name, command)
})

const cooldowns = new Collection()

client.on('message', async (message) => {
  if (!message.content.startsWith(prefix) || message.author.bot) {
    return
  }

  // Parse the message content
  const args = message.content.slice(prefix.length).split(/ +/)
  const commandName = args.shift().toLowerCase()

  // Search for a matching command
  const command = client.commands.get(commandName) ||
    client.commands.find((c) => c.aliases && c.aliases.includes(commandName))
  if (!command) {
    return
  }

  // Check user's authorization
  if (command.guildOnly && message.channel.type !== 'text') {
    message.reply("I can't execute that command inside DMs!")
    return
  }

  // Validate the command
  if (command.args && !args.length) {
    let reply = `You didn't provide any arguments, ${message.author}!`

    if (command.usage) {
      reply += `\nThe proper usage would be: \`${prefix}${command.name} ${command.usage}\``
    }

    message.channel.send(reply)
    return
  }

  // Check for command cooldowns
  if (!cooldowns.has(command.name)) {
    cooldowns.set(command.name, new Collection())
  }

  const now = Date.now()
  const timestamps = cooldowns.get(command.name)
  const cooldownAmount = (command.cooldown || defaultCooldown) * 1000

  if (timestamps.has(message.author.id)) {
    const expirationTime = timestamps.get(message.author.id) + cooldownAmount

    if (now < expirationTime) {
      const timeLeft = (expirationTime - now) / 1000
      const timeLeftSeconds = timeLeft.toFixed(1)
      message.reply(`Please wait ${timeLeftSeconds} more ${timeLeftSeconds === 1 ? 'second' : 'seconds'} before reusing the ${command.name} command.`)
      return
    }
  }

  timestamps.set(message.author.id, now)
  setTimeout(() => timestamps.delete(message.author.id), cooldownAmount)

  try {
    logger.verbose(`Executing command ${command.name} with args ${args}`)
    await command.execute(logger, message, args, secrets)
  } catch (e) {
    logger.error(e)
    message.reply('There was an error trying to execute that command!')
  }
})

// Login using token
if (secrets.token) {
  client.login(secrets.token)
} else {
  logger.error('No Discord token provided.')
}
