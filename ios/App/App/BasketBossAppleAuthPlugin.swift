import Foundation
import UIKit
import AuthenticationServices
import CryptoKit
import Security
import Capacitor

// Native authorization only. Supabase validates the Apple ID token and nonce;
// this bridge never creates sessions, writes credentials or grants Premium.
@objc(BasketBossAppleAuthPlugin)
public final class BasketBossAppleAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "BasketBossAppleAuthPlugin"
    public let jsName = "BasketBossAppleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]
    // All mutable state is confined to the main actor. One operation owns its
    // controller, state and nonce until success, cancellation or the deadline.
    private var pendingCall: CAPPluginCall?
    private var controller: ASAuthorizationController?
    private var rawNonce: String?
    private var requestState: String?
    private var anchorWindow: UIWindow?
    private var deadline: DispatchWorkItem?

    deinit { deadline?.cancel() }

    @objc public func available(_ call: CAPPluginCall) {
        // The plugin is registered only by the signed iOS target with the
        // Sign in with Apple entitlement. Provider availability is checked by
        // the existing web auth owner before this native operation is offered.
        call.resolve(["available": true])
    }

    @objc public func signIn(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let self = self else { call.reject("Apple sign-in is unavailable.", "BB_APPLE_UNAVAILABLE"); return }
            guard self.pendingCall == nil else { call.reject("Apple sign-in is already open.", "BB_APPLE_BUSY"); return }
            guard let window = self.bridge?.viewController?.view.window,
                  UIApplication.shared.applicationState == .active else {
                call.reject("Open BasketBoss to sign in with Apple.", "BB_APPLE_UNAVAILABLE"); return
            }
            guard let nonce = Self.randomValue(), let state = Self.randomValue() else {
                call.reject("Apple sign-in could not start securely.", "BB_APPLE_UNAVAILABLE"); return
            }
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.email]
            request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
            request.state = state
            let controller = ASAuthorizationController(authorizationRequests: [request])
            self.pendingCall = call
            self.rawNonce = nonce
            self.requestState = state
            self.anchorWindow = window
            self.controller = controller
            controller.delegate = self
            controller.presentationContextProvider = self
            let timeout = DispatchWorkItem { [weak self, weak controller] in
                Task { @MainActor [weak self, weak controller] in
                    guard let self = self, let controller = controller, self.controller === controller else { return }
                    self.reject("Apple sign-in timed out. Please try again.", code: "BB_APPLE_AUTH_FAILED", cancelRequest: true)
                }
            }
            self.deadline = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 120, execute: timeout)
            controller.performRequests()
        }
    }

    @objc public func cancel(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            self?.reject("Apple sign-in was cancelled.", code: "BB_APPLE_CANCELLED", cancelRequest: true)
            call.resolve()
        }
    }

    @MainActor public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // A real foreground window is required before performRequests().
        return anchorWindow ?? bridge?.viewController?.view.window ?? UIWindow()
    }

    @MainActor public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard self.controller === controller, let call = pendingCall else { return }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let nonce = rawNonce, let state = requestState, credential.state == state,
              let tokenData = credential.identityToken, tokenData.count <= 16384,
              let token = String(data: tokenData, encoding: .utf8), !token.isEmpty else {
            reject("Apple did not return a valid sign-in credential.", code: "BB_APPLE_INVALID_CREDENTIAL"); return
        }
        var payload: JSObject = ["identityToken": token, "nonce": nonce]
        // Ephemeral only: a fresh deletion confirmation can send this code to
        // the authenticated server for Apple's token-revocation requirement.
        if let codeData = credential.authorizationCode, codeData.count <= 4096,
           let code = String(data: codeData, encoding: .utf8), !code.isEmpty {
            payload["authorizationCode"] = code
        }
        clear()
        call.resolve(payload)
    }

    @MainActor public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard self.controller === controller else { return }
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        reject(cancelled ? "Apple sign-in was cancelled." : "Apple sign-in could not complete. Please try again.",
               code: cancelled ? "BB_APPLE_CANCELLED" : "BB_APPLE_AUTH_FAILED")
    }

    @MainActor private func reject(_ message: String, code: String, cancelRequest: Bool = false) {
        let call = pendingCall, active = controller
        clear()
        if cancelRequest { active?.cancel() }
        call?.reject(message, code)
    }

    @MainActor private func clear() {
        deadline?.cancel(); deadline = nil
        controller?.delegate = nil
        controller?.presentationContextProvider = nil
        controller = nil; pendingCall = nil
        rawNonce = nil; requestState = nil; anchorWindow = nil
    }

    private static func randomValue() -> String? {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        guard status == errSecSuccess else { return nil }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}
