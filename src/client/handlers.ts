import type { ConfirmChannel } from "amqplib";
import type { ArmyMove, RecognitionOfWar } from "../internal/gamelogic/gamedata.js";
import type {
  GameState,
  PlayingState,
} from "../internal/gamelogic/gamestate.js";
import { handleMove, MoveOutcome } from "../internal/gamelogic/move.js";
import { handlePause } from "../internal/gamelogic/pause.js";
import { AckType } from "../internal/pubsub/consume.js";
import { publishJSON } from "../internal/pubsub/publish.js";
import { ExchangePerilTopic, WarRecognitionsPrefix } from "../internal/routing/routing.js";
import { handleWar, WarOutcome } from "../internal/gamelogic/war.js";
import { publishGameLog } from "./index.js";

export function handlerPause(gs: GameState): (ps: PlayingState) => AckType {
  return (ps: PlayingState) => {
    handlePause(gs, ps);
    process.stdout.write("> ");
    return AckType.Ack;
  };
}

export function handlerMove(gs: GameState, ch: ConfirmChannel): (move: ArmyMove) => AckType {
  return (move: ArmyMove): AckType => {
    try {
      const outcome = handleMove(gs, move);
      switch (outcome) {
        case MoveOutcome.Safe:
        case MoveOutcome.SamePlayer:
            return AckType.Ack;
        case MoveOutcome.MakeWar:
            const recognition: RecognitionOfWar = {
                attacker: move.player,
                defender: gs.getPlayerSnap(),
            };

            try {
                publishJSON(
                    ch,
                    ExchangePerilTopic,
                    `${WarRecognitionsPrefix}.${gs.getUsername()}`,
                    recognition
                );
            } catch (error) {
                console.error("Error publishing war recognition:", error);
                return AckType.NackRequeue;
            } finally {
                return AckType.Ack;
            }
        default:
            return AckType.NackDiscard;
      }
    } finally {
      process.stdout.write("> ");
    }
  };
}

export function handlerWar(
    gs: GameState,
    ch: ConfirmChannel
): (war: RecognitionOfWar) => Promise<AckType> {
    return async (war: RecognitionOfWar): Promise<AckType> => {
        try {
            const resolution = handleWar(gs, war);
            let message: string;

            switch (resolution.result) {
                case WarOutcome.NotInvolved:
                    return AckType.NackRequeue;
                case WarOutcome.NoUnits:
                    return AckType.NackDiscard;
                case WarOutcome.YouWon:
                case WarOutcome.OpponentWon:
                    message = `${resolution.winner} has won a war against ${resolution.loser}`;
                    try {
                        publishGameLog(ch, gs.getUsername(), message);
                    } catch (err) {
                        console.error("Error publishing game log:", err);
                        return AckType.NackRequeue;
                    } finally {
                        return AckType.Ack;
                    }
                case WarOutcome.Draw:
                    message = `A war between ${resolution.attacker} and ${resolution.defender} resulted in a draw!`;
                    try {
                        publishGameLog(ch, gs.getUsername(), message);
                    } catch (err) {
                        console.error("Error publishing game log:", err);
                        return AckType.NackRequeue;
                    } finally {
                        return AckType.Ack;
                    }
                default:
                    const unreachable: never = resolution;
                    console.log("Unexpected war resolution: ", unreachable);
                    return AckType.NackDiscard;
            }
        } finally {
            process.stdout.write("> ");
        }
    }
}
