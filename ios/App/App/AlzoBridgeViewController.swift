import Capacitor

// Los plugins locales no se autoregistran en Capacitor 6+: hay que hacerlo aqui.
// Main.storyboard apunta a esta clase en lugar de CAPBridgeViewController.
class AlzoBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SessionLiveActivityPlugin())
    }
}
