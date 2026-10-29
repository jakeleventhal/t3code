import CoreText
import UIKit

@MainActor
enum T3InstalledFonts {
  enum SelectionError: LocalizedError {
    case unavailable

    var errorDescription: String? {
      "iOS could not activate the selected font. Your previous font has been kept."
    }
  }

  static func activate(_ descriptor: UIFontDescriptor, completion: @escaping (Result<UIFont, SelectionError>) -> Void) {
    // A picker descriptor can name a provider font that this process has not activated yet.
    let requested = CTFontDescriptorCreateWithAttributes(descriptor.fontAttributes as CFDictionary)
    CTFontManagerRequestFonts([requested] as CFArray) { unresolved in
      DispatchQueue.main.async {
        guard CFArrayGetCount(unresolved) == 0 else {
          completion(.failure(.unavailable))
          return
        }
        let font = UIFont(descriptor: descriptor, size: 16)
        let name = descriptor.object(forKey: .name) as? String
        let family = descriptor.object(forKey: .family) as? String
        guard font.fontName == name || font.familyName == family else {
          completion(.failure(.unavailable))
          return
        }
        completion(.success(font))
      }
    }
  }

  static func describe(_ font: UIFont, name: String? = nil) -> [String: Any] {
    func variant(_ weight: UIFont.Weight) -> String {
      let descriptor = UIFontDescriptor(fontAttributes: [
        .family: font.familyName,
        .traits: [UIFontDescriptor.TraitKey.weight: weight],
      ])
      let candidate = UIFont(descriptor: descriptor, size: font.pointSize)
      return candidate.familyName == font.familyName ? candidate.fontName : font.fontName
    }
    // CoreText reports medium as 0.20 while UIKit requests 0.23.
    var emphasisFaces: [String: String] = [:]
    for (key, weight) in [("500", UIFont.Weight.medium), ("600", .semibold), ("700", .bold)] {
      let name = variant(weight)
      guard let candidate = UIFont(name: name, size: font.pointSize),
            let traits = candidate.fontDescriptor.object(forKey: .traits) as? [UIFontDescriptor.TraitKey: Any],
            let actual = traits[.weight] as? NSNumber,
            abs(actual.doubleValue - Double(weight.rawValue)) < 0.04 else { continue }
      emphasisFaces[key] = name
    }
    return [
      "name": name ?? font.fontName,
      "label": font.familyName,
      "regular": font.fontName,
      "medium": variant(.medium),
      "bold": variant(.bold),
      "emphasisFaces": emphasisFaces,
    ]
  }

  static func resolve(_ names: [String], completion: @escaping ([[String: Any]]) -> Void) {
    guard !names.isEmpty else { completion([]); return }
    // Provider fonts must be requested again for each process. Persist names,
    // not file URLs: iOS owns the files and the picker grants family access.
    let descriptors = names.map { CTFontDescriptorCreateWithAttributes([kCTFontNameAttribute: $0] as CFDictionary) }
    CTFontManagerRequestFonts(descriptors as CFArray) { _ in
      DispatchQueue.main.async {
        completion(names.compactMap { name in
          guard let font = UIFont(name: name, size: 16) else { return nil }
          return describe(font, name: name)
        })
      }
    }
  }
}

@MainActor
final class T3FontPickerPresentation: NSObject, UIFontPickerViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
  private let completion: (Result<[String: Any]?, T3InstalledFonts.SelectionError>) -> Void
  private var picker: UIFontPickerViewController?
  private var finished = false

  init(completion: @escaping (Result<[String: Any]?, T3InstalledFonts.SelectionError>) -> Void) {
    self.completion = completion
  }

  func present(from presenter: UIViewController, selectedName: String?) {
    let configuration = UIFontPickerViewController.Configuration()
    configuration.includeFaces = false
    let picker = UIFontPickerViewController(configuration: configuration)
    if let selectedName, let font = UIFont(name: selectedName, size: 16) {
      picker.selectedFontDescriptor = font.fontDescriptor
    }
    picker.delegate = self
    self.picker = picker
    presenter.present(picker, animated: true)
    picker.presentationController?.delegate = self
  }

  func fontPickerViewControllerDidPickFont(_ viewController: UIFontPickerViewController) {
    guard let descriptor = viewController.selectedFontDescriptor else { dismiss(); return }
    T3InstalledFonts.activate(descriptor) { [weak self] result in
      guard let self, !self.finished else { return }
      viewController.dismiss(animated: true) {
        self.finish(result.map { T3InstalledFonts.describe($0) })
      }
    }
  }

  func fontPickerViewControllerDidCancel(_ viewController: UIFontPickerViewController) {
    dismiss()
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finish(.success(nil))
  }

  func dismiss() {
    guard let picker else { finish(.success(nil)); return }
    picker.dismiss(animated: true) { self.finish(.success(nil)) }
  }

  private func finish(_ result: Result<[String: Any]?, T3InstalledFonts.SelectionError>) {
    guard !finished else { return }
    finished = true
    picker?.delegate = nil
    picker = nil
    completion(result)
  }
}
