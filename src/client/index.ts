import amqp from "amqplib";
import { clientWelcome, commandStatus, getInput, getMaliciousLog, printClientHelp, printQuit } from "../internal/gamelogic/gamelogic.js";
import { declareAndBind, SimpleQueueType } from "../internal/pubsub/consume.js";
import { ArmyMovesPrefix, ExchangePerilDirect, ExchangePerilTopic, GameLogSlug, PauseKey, WarRecognitionsPrefix } from "../internal/routing/routing.js";
import { GameState } from "../internal/gamelogic/gamestate.js";
import { commandSpawn } from "../internal/gamelogic/spawn.js";
import { commandMove, handleMove } from "../internal/gamelogic/move.js";
import { subscribeJSON } from "../internal/pubsub/consume.js";
import { handlerMove, handlerPause, handlerWar } from "./handlers.js";
import { publishJSON, publishMsgPack } from "../internal/pubsub/publish.js";
import type { GameLog } from "../internal/gamelogic/logs.js";

async function main() {
  console.log("Starting Peril client...");
  const rabbitConnString = "amqp://guest:guest@localhost:5672/";
    const conn = await amqp.connect(rabbitConnString);
    console.log("Peril game server connected to RabbitMQ!");
  
    ["SIGINT", "SIGTERM"].forEach((signal) =>
      process.on(signal, async () => {
        try {
          await conn.close();
          console.log("RabbitMQ connection closed.");
        } catch (err) {
          console.error("Error closing RabbitMQ connection:", err);
        } finally {
          process.exit(0);
        }
      }),
    );

  const userName = await clientWelcome();
  const publishCh = await conn.createConfirmChannel();
  const gameState = new GameState(userName);

  declareAndBind(
    conn, 
    ExchangePerilDirect, 
    `${PauseKey}.${userName}`, 
    PauseKey, 
    SimpleQueueType.Transient
  );

  subscribeJSON(
    conn, 
    ExchangePerilDirect, 
    `${PauseKey}.${userName}`, 
    PauseKey, SimpleQueueType.Transient, 
    handlerPause(gameState)
  );
  
  subscribeJSON(
    conn, 
    ExchangePerilTopic, 
    `${ArmyMovesPrefix}.${userName}`, 
    `${ArmyMovesPrefix}.*`, 
    SimpleQueueType.Transient, 
    handlerMove(gameState, publishCh)
  );

  subscribeJSON(
    conn,
    ExchangePerilTopic,
    WarRecognitionsPrefix,
    `${WarRecognitionsPrefix}.*`,
    SimpleQueueType.Durable,
    handlerWar(gameState, publishCh)
  )

  while (true) {
    let words = await getInput();
    if (words.length === 0) continue;

    const command = words[0]!.toLowerCase();
    switch (command) {
      case "help":
        printClientHelp();
        break;
      case "quit":
        printQuit();
        await conn.close();
        process.exit(0);
      case "spawn":
        try {
          commandSpawn(gameState as GameState, words);
        } catch (err) {
          console.log("Error executing spawn command:", err);
        }
        break;
      case "move":
        try {
          const move = commandMove(gameState, words);
          publishJSON(publishCh, ExchangePerilTopic, `${ArmyMovesPrefix}.${userName}`, move);
          console.log(`Published move: To ${move.toLocation} with ${move.units.length} units.`);
        } catch (err) {
          console.log("Error executing move command:", err);
        }
        break;
      case "status":
        commandStatus(gameState);
        break;
      case "spam":
        if (words.length < 2) {
          console.log("Usage: spam <number_of_messages>");
          break;
        }
        const count = parseInt(words[1]!, 10);
        if (isNaN(count) || count <= 0) {
          console.log("Please provide a valid positive integer for the number of messages.");
          break;
        }
        for (let i = 0; i < count; i++) {
          const log = getMaliciousLog();
          const gameLog: GameLog = {
            currentTime: new Date(),
            message: log,
            username: userName,
          };
          publishMsgPack(publishCh, ExchangePerilTopic, `${GameLogSlug}.${userName}`, gameLog);
        }
        console.log(`Published ${count} malicious log messages.`);
        break;
      default:
        console.log(`Unknown command: ${command}`);
        printClientHelp();
    }
  }
}

export function publishGameLog(publishCh: amqp.ConfirmChannel, username: string, message: string) {
  const logEntry: GameLog = {
    currentTime: new Date(),
    message,
    username,
  };

  try {
    publishMsgPack(publishCh, ExchangePerilTopic, `${GameLogSlug}.${username}`, logEntry);
  } catch (err) {
    console.error("Error publishing game log:", err);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
