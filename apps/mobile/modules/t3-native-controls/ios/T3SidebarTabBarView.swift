import ExpoModulesCore
import UIKit

private final class WorkspaceTabBar: UITabBar {
  var onContentLayout: ((CGRect) -> Void)?

  override func layoutSubviews() {
    super.layoutSubviews()
    let labels = Set((items ?? []).compactMap(\.accessibilityLabel))
    let accessible = tabFrames(in: self, labels: labels)
    if accessible.count == items?.count {
      let row = accessible.values.reduce(CGRect.null) { $0.union($1) }
      if !row.isNull { onContentLayout?(row); return }
    }
    // iOS 26.6 doesn't copy item identifiers onto its tab buttons; the bar holds no other controls.
    let identified = tabButtons(in: self) { $0.accessibilityIdentifier?.hasPrefix("workspace-tab-") == true }
    let buttons = identified.isEmpty ? tabButtons(in: self) { _ in true } : identified
    guard buttons.count == items?.count else { return }
    let row = buttons.reduce(CGRect.null) { $0.union(convert($1.bounds, from: $1)) }
    if !row.isNull { onContentLayout?(row) }
  }

  private func tabFrames(in view: UIView, labels: Set<String>) -> [String: CGRect] {
    var frames: [String: CGRect] = [:]
    // Floating UIKit bars can expose tab items through accessibility containers
    // rather than UIControls. Their screen frames describe the visible row.
    let elements = [view] + (view.accessibilityElements?.compactMap { $0 as? NSObject } ?? [])
    if let window {
      for element in elements {
        guard let label = element.accessibilityLabel, labels.contains(label) else { continue }
        let frame = element.accessibilityFrame
        guard frame.width > 0, frame.height > 0 else { continue }
        frames[label] = convert(window.convert(frame, from: window.screen.coordinateSpace), from: window)
      }
    }
    for child in view.subviews where !child.isHidden {
      frames.merge(tabFrames(in: child, labels: labels)) { previous, _ in previous }
    }
    return frames
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    invalidateIntrinsicContentSize()
  }

  private func tabButtons(in view: UIView, matching match: (UIView) -> Bool) -> [UIView] {
    view.subviews.filter { !$0.isHidden }.flatMap { subview in
      let descendants = tabButtons(in: subview, matching: match)
      if !descendants.isEmpty { return descendants }
      return subview is UIControl && match(subview) ? [subview] : []
    }
  }
}

final class T3SidebarTabBarView: ExpoView, UITabBarDelegate {
  let onSelectionChange = EventDispatcher()
  let onCompose = EventDispatcher()
  let onComposeLayout = EventDispatcher()
  private var reportedComposeFrame: CGRect?
  private let tabBar = WorkspaceTabBar()
  private var tabContentFrame: CGRect?
  private let composeButton = UIButton(type: .system)
  private lazy var tabBarTrailing = tabBar.trailingAnchor.constraint(equalTo: trailingAnchor)
  private var itemsByTab: [String: UITabBarItem] = [:]
  var tabs = ["threads", "pullRequests", "usage", "settings"] {
    didSet { if tabs != oldValue { updateItems() } }
  }
  var botBadge = "" { didSet { itemsByTab["bots"]?.badgeValue = botBadge.isEmpty ? nil : botBadge } }
  var selectedTab = "threads" { didSet { updateSelection() } }
  var selectedColor: UIColor = .systemBlue { didSet { tabBar.tintColor = selectedColor } }
  var compact = false {
    didSet {
      tabBarTrailing.constant = showsCompose ? (compact ? -64 : -76) : 0
      tabBar.setNeedsLayout()
    }
  }
  var showsCompose = false {
    didSet {
      composeButton.isHidden = !showsCompose
      tabBarTrailing.constant = showsCompose ? (compact ? -64 : -76) : 0
      // JS widens this view by the same amount the bar gives up, so the bar's frame can stay put
      // and UIKit would skip the layout pass that places Compose, leaving it at the origin.
      tabBar.setNeedsLayout()
      setNeedsLayout()
    }
  }
  var appearance = "light" {
    didSet { overrideUserInterfaceStyle = appearance == "dark" ? .dark : .light }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    tabBar.itemPositioning = .fill
    // iPad's regular bar uses a compressed inline row even with fill positioning.
    // This floating sidebar control needs the same full-size items as a phone bar.
    if #available(iOS 17.0, *) {
      tabBar.traitOverrides.horizontalSizeClass = .compact
    }
    tabBar.delegate = self
    tabBar.translatesAutoresizingMaskIntoConstraints = false
    addSubview(tabBar)
    NSLayoutConstraint.activate([
      tabBar.leadingAnchor.constraint(equalTo: leadingAnchor),
      tabBarTrailing,
      tabBar.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
    // UIKit's floating row changes with window geometry. Follow its laid-out items
    // instead of estimating their position from a second set of safe-area updates.
    tabBar.onContentLayout = { [weak self] frame in
      self?.tabContentFrame = frame
      self?.layoutCompose(alongside: frame)
    }
    composeButton.accessibilityLabel = "New thread"
    composeButton.addAction(UIAction { [weak self] _ in self?.onCompose() }, for: .touchUpInside)
    composeButton.isHidden = true
    addSubview(composeButton)
    configureCompose()
    prepareItems()
    updateItems()
  }

  private func configureCompose() {
    var configuration: UIButton.Configuration
    if #available(iOS 26.0, *) {
      configuration = .glass()
    } else {
      configuration = .gray()
    }
    configuration.cornerStyle = .capsule
    configuration.baseForegroundColor = .label
    configuration.image = tabIcon(UIImage(systemName: "square.and.pencil"))
    composeButton.configuration = configuration
  }

  private func prepareItems() {
    let iconBundle = Bundle(for: Self.self).url(forResource: "T3NativeControlIcons", withExtension: "bundle").flatMap(Bundle.init(url:))
    let pullRequestIcon = UIImage(named: "pull-request", in: iconBundle, compatibleWith: nil)?.withRenderingMode(.alwaysTemplate)
    let labels = ["threads": "Chats", "pullRequests": "PRs", "usage": "Usage", "bots": "Bots", "settings": "Settings"]
    let symbols = ["threads": "text.bubble", "usage": "chart.bar.xaxis", "bots": "square.grid.2x2", "settings": "gearshape"]
    let selectedSymbols = ["threads": "text.bubble.fill", "bots": "square.grid.2x2.fill"]
    for (tab, label) in labels {
      let icon = tab == "pullRequests" ? pullRequestIcon : UIImage(systemName: symbols[tab] ?? "circle")
      let item = UITabBarItem(title: nil, image: tabIcon(icon), tag: 0)
      item.accessibilityLabel = label
      item.accessibilityIdentifier = "workspace-tab-\(tab)"
      if let selected = selectedSymbols[tab] { item.selectedImage = tabIcon(UIImage(systemName: selected)) }
      itemsByTab[tab] = item
    }
  }

  private func updateItems() {
    tabBar.items = tabs.enumerated().compactMap { index, tab in
      guard let item = itemsByTab[tab] else { return nil }
      item.tag = index
      return item
    }
    updateSelection()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // UIKit may omit accessibility identifiers from its private tab controls. The
    // public bar frame still gives Compose a trailing slot and a real hit target.
    guard showsCompose else { return }
    tabBar.layoutIfNeeded()
    let contentHeight = max(44, tabBar.bounds.height - tabBar.safeAreaInsets.bottom)
    layoutCompose(alongside: tabContentFrame ?? CGRect(x: 0, y: 0, width: tabBar.bounds.width, height: contentHeight))
  }

  private func layoutCompose(alongside frame: CGRect) {
    guard showsCompose, frame.height > 0 else { return }
    let row = convert(frame, from: tabBar)
    let size: CGFloat = compact ? 56 : 64
    let frame = CGRect(x: bounds.width - size - 4, y: row.midY - size / 2, width: size, height: size)
    composeButton.frame = frame
    if reportedComposeFrame != frame {
      reportedComposeFrame = frame
      onComposeLayout(["top": frame.minY, "right": bounds.width - frame.maxX])
    }
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    if showsCompose, let target = composeButton.hitTest(convert(point, to: composeButton), with: event) {
      return target
    }
    return tabBar.hitTest(convert(point, to: tabBar), with: event)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateSelection()
  }

  // Give symbols and bitmap assets the same image box; UIKit otherwise scales symbols independently.
  private func tabIcon(_ image: UIImage?) -> UIImage? {
    guard let image else { return nil }
    let canvas = CGSize(width: 28, height: 28)
    let scale = min(24 / image.size.width, 24 / image.size.height)
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    return UIGraphicsImageRenderer(size: canvas).image { _ in
      image.draw(in: CGRect(x: (canvas.width - size.width) / 2, y: (canvas.height - size.height) / 2, width: size.width, height: size.height))
    }.withRenderingMode(.alwaysTemplate)
  }

  private func updateSelection() {
    guard let item = itemsByTab[selectedTab], tabBar.items?.contains(item) == true else { return }
    guard tabBar.selectedItem !== item else { return }
    tabBar.selectedItem = item
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    guard tabs.indices.contains(item.tag) else { return }
    onSelectionChange(["tab": tabs[item.tag]])
  }
}
