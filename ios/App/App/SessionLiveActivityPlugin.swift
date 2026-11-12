import ActivityKit
import Capacitor
import Foundation

// Plugin local (no esta en npm): se registra en AlzoBridgeViewController.
@objc(SessionLiveActivityPlugin)
public class SessionLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SessionLiveActivityPlugin"
    public let jsName = "SessionLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    @objc func sync(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.unavailable("Live Activities requieren iOS 16.2")
            return
        }
        let routineName = call.getString("routineName") ?? ""
        let now = Date()
        let restEndsAt = call.getDouble("restEndsAtMs")
            .map { Date(timeIntervalSince1970: $0 / 1000) }
            .flatMap { $0 > now ? $0 : nil }
        let state = AlzoSessionAttributes.ContentState(
            exerciseName: call.getString("exerciseName") ?? "",
            setNumber: call.getInt("setNumber") ?? 0,
            setTotal: call.getInt("setTotal") ?? 0,
            setsDone: call.getInt("setsDone") ?? 0,
            setsAll: call.getInt("setsAll") ?? 0,
            elapsedAnchor: call.getDouble("elapsedAnchorMs").map { Date(timeIntervalSince1970: $0 / 1000) },
            elapsedPaused: (call.getDouble("elapsedPausedMs") ?? 0) / 1000,
            restEndsAt: restEndsAt
        )
        Task {
            do {
                try await SessionLiveActivityController.sync(routineName: routineName, state: state)
                call.resolve()
            } catch {
                call.reject("No se pudo actualizar la Live Activity: \(error.localizedDescription)")
            }
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        Task {
            await SessionLiveActivityController.endAll()
            call.resolve()
        }
    }
}

@available(iOS 16.2, *)
enum SessionLiveActivityController {
    static func sync(routineName: String, state: AlzoSessionAttributes.ContentState) async throws {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        // staleDate = fin del descanso: al pasar, la vista muestra "Descanso terminado"
        // sin que el JS (congelado con la pantalla bloqueada) tenga que hacer nada.
        let content = ActivityContent(state: state, staleDate: state.restEndsAt)

        // Solo activas: una descartada por el usuario puede seguir en la lista y no admite update.
        if let current = Activity<AlzoSessionAttributes>.activities.first(where: { $0.activityState == .active }) {
            if current.attributes.routineName == routineName {
                await current.update(content)
                return
            }
            // Otra rutina: es otra sesion.
            await current.end(nil, dismissalPolicy: .immediate)
        }
        _ = try Activity.request(
            attributes: AlzoSessionAttributes(routineName: routineName),
            content: content,
            pushType: nil
        )
    }

    static func endAll() async {
        for activity in Activity<AlzoSessionAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
