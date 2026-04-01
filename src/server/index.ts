import amqp from "amqplib";
import { publishJSON } from "../internal/pubsub/publish.js";
import { ExchangePerilDirect, ExchangePerilTopic, GameLogSlug, PauseKey } from "../internal/routing/routing.js";
import { getInput, printServerHelp } from "../internal/gamelogic/gamelogic.js";
import { declareAndBind, SimpleQueueType, subscribeMsgPack } from "../internal/pubsub/consume.js";
import { handlerLog } from "./handlers.js";

async function main() {
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

  const publishCh = await conn.createConfirmChannel();

  subscribeMsgPack(
    conn,
    ExchangePerilTopic,
    GameLogSlug,
    `${GameLogSlug}.*`,
    SimpleQueueType.Durable,
    handlerLog(),
  );

  // Used to run the server from a non-interactive source, like the multiserver.sh file
  if (!process.stdin.isTTY) {
    console.log("Non-interactive mode: skipping command input.");
    return;
  }

  printServerHelp();

  while (true) {
    let words = await getInput();

    if (words.length === 0) continue;

    const command = words[0]!.toLowerCase();
    switch (command) {
      case "pause":
        try {
          await publishJSON(publishCh, ExchangePerilDirect, PauseKey, {
            isPaused: true,
          });
          console.log("Game paused.");
        } catch (err) {
          console.error("Error publishing pause message:", err);
        }
        break;
      case "resume":
        try {
          await publishJSON(publishCh, ExchangePerilDirect, PauseKey, {
            isPaused: false,
          });
          console.log("Game resumed.");
        } catch (err) {
          console.error("Error publishing resume message:", err);
        }
        break;
      case "help":
        printServerHelp();
        break;
      case "quit":
        console.log("Shutting down server...");
        await publishCh.close();
        await conn.close();
        console.log("Server shut down.");
        process.exit(0);
      default:
        console.log(`Unknown command: ${command}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
