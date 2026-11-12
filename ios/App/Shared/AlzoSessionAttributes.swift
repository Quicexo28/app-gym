import ActivityKit
import Foundation

// Compartido por la app (que inicia/actualiza la actividad) y la extension (que la dibuja).
// Pertenece a AMBOS targets.
@available(iOS 16.2, *)
struct AlzoSessionAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var exerciseName: String
        var setNumber: Int
        var setTotal: Int
        var setsDone: Int
        var setsAll: Int
        /// Cronometro corriendo: instante virtual de inicio (now - transcurrido). nil si esta en pausa.
        var elapsedAnchor: Date?
        /// Transcurrido congelado cuando esta en pausa.
        var elapsedPaused: TimeInterval
        /// Fin del descanso en curso. nil si no hay.
        var restEndsAt: Date?
    }

    var routineName: String
}
