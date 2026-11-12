import ActivityKit
import SwiftUI
import WidgetKit

// Todo lo que "corre" son vistas de SwiftUI que cuentan solas (Text con timer):
// con la pantalla bloqueada el JS de la app esta congelado y no puede actualizar nada.

@available(iOS 16.2, *)
struct AlzoSessionLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlzoSessionAttributes.self) { context in
            LockScreenView(attributes: context.attributes, state: context.state, isStale: context.isStale)
                .padding(16)
                .activityBackgroundTint(Color.black.opacity(0.85))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.exerciseName)
                        .font(.headline)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ElapsedText(state: context.state)
                        .font(.headline.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        RestOrSetLine(state: context.state, isStale: context.isStale)
                        ProgressView(value: Double(context.state.setsDone), total: Double(max(context.state.setsAll, 1)))
                            .tint(.green)
                    }
                }
            } compactLeading: {
                Image(systemName: "dumbbell.fill")
            } compactTrailing: {
                if let end = context.state.restEndsAt, !context.isStale {
                    Text(timerInterval: Date()...end, countsDown: true)
                        .monospacedDigit()
                        .frame(width: 44)
                } else {
                    Text("\(context.state.setsDone)/\(context.state.setsAll)")
                        .monospacedDigit()
                }
            } minimal: {
                Image(systemName: "dumbbell.fill")
            }
        }
    }
}

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let attributes: AlzoSessionAttributes
    let state: AlzoSessionAttributes.ContentState
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(attributes.routineName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                ElapsedText(state: state)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Text(state.exerciseName)
                .font(.title3.bold())
                .lineLimit(1)
            RestOrSetLine(state: state, isStale: isStale)
            ProgressView(value: Double(state.setsDone), total: Double(max(state.setsAll, 1)))
                .tint(.green)
        }
    }
}

@available(iOS 16.2, *)
private struct RestOrSetLine: View {
    let state: AlzoSessionAttributes.ContentState
    let isStale: Bool

    var body: some View {
        if let end = state.restEndsAt, end > Date(), !isStale {
            HStack {
                Text("Descanso")
                Spacer()
                Text(timerInterval: Date()...end, countsDown: true)
                    .font(.title2.bold().monospacedDigit())
                    .foregroundStyle(.orange)
            }
        } else if state.restEndsAt != nil {
            Text("Descanso terminado · siguiente serie")
                .font(.subheadline.bold())
                .foregroundStyle(.green)
        } else {
            Text("Serie \(state.setNumber) de \(state.setTotal) · \(state.setsDone)/\(state.setsAll) hechas")
                .font(.subheadline)
        }
    }
}

@available(iOS 16.2, *)
private struct ElapsedText: View {
    let state: AlzoSessionAttributes.ContentState

    var body: some View {
        if let anchor = state.elapsedAnchor {
            // Sube solo desde el instante virtual de inicio.
            Text(anchor, style: .timer)
        } else {
            Text(Self.format(state.elapsedPaused))
        }
    }

    private static func format(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
    }
}
