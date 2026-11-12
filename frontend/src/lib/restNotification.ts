import { Capacitor } from "@capacitor/core";

// Id fijo: solo hay un descanso activo a la vez, reprogramar reemplaza al anterior.
const REST_NOTIFICATION_ID = 4101;

// El timer JS se congela con la pantalla bloqueada (WKWebView/Android Doze), asi que
// el aviso de fin de descanso se programa en el sistema operativo al iniciarlo.
export async function scheduleRestNotification(endsAtMs: number, exerciseName: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
    if (endsAtMs <= Date.now()) return;
    let { display } = await LocalNotifications.checkPermissions();
    if (display === "prompt" || display === "prompt-with-rationale") {
      ({ display } = await LocalNotifications.requestPermissions());
    }
    if (display !== "granted") return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: REST_NOTIFICATION_ID,
          title: "Descanso finalizado",
          body: `Siguiente serie. Último: ${exerciseName}.`,
          schedule: { at: new Date(endsAtMs), allowWhileIdle: true },
        },
      ],
    });
  } catch (err) {
    console.error("No se pudo programar la notificación de descanso", err);
  }
}

export async function cancelRestNotification(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
  } catch {
    // Sin plugin o sin permiso: nada que cancelar.
  }
}
