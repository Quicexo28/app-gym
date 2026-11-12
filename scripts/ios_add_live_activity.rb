# Registra en ios/App/App.xcodeproj la extension AlzoLiveActivity (Live Activity)
# y los archivos Swift nuevos de la app. Idempotente: si el target ya existe, no hace nada.
# Uso (desde la raiz):  gem install xcodeproj && ruby scripts/ios_add_live_activity.rb [ruta.xcodeproj]
require "xcodeproj"

path = ARGV[0] || "ios/App/App.xcodeproj"
project = Xcodeproj::Project.open(path)
app = project.targets.find { |t| t.name == "App" } or abort("target App no encontrado")
if project.targets.any? { |t| t.name == "AlzoLiveActivity" }
  puts "AlzoLiveActivity ya existe: nada que hacer"
  exit 0
end

EXT_BUNDLE_ID = "com.santiagoquiceno.alzo.LiveActivity"
app_cfg = app.build_configurations.first.build_settings

# --- archivos Swift nuevos de la app ---
app_group = project.main_group["App"] or abort("grupo App no encontrado")
%w[SessionLiveActivityPlugin.swift AlzoBridgeViewController.swift].each do |f|
  app.add_file_references([app_group.new_file(f)])
end

# --- archivo compartido (en ambos targets) ---
shared_group = project.main_group.new_group("Shared", "Shared")
shared_ref = shared_group.new_file("AlzoSessionAttributes.swift")
app.add_file_references([shared_ref])

# --- target de la extension ---
ext = project.new_target(:app_extension, "AlzoLiveActivity", :ios, "16.2")
ext_group = project.main_group.new_group("AlzoLiveActivity", "AlzoLiveActivity")
sources = %w[AlzoLiveActivityBundle.swift AlzoSessionLiveActivity.swift].map { |f| ext_group.new_file(f) }
ext_group.new_file("Info.plist")
ext.add_file_references(sources + [shared_ref])

ext.build_configurations.each do |cfg|
  s = cfg.build_settings
  s["PRODUCT_BUNDLE_IDENTIFIER"] = EXT_BUNDLE_ID
  s["PRODUCT_NAME"] = "$(TARGET_NAME)"
  s["INFOPLIST_FILE"] = "AlzoLiveActivity/Info.plist"
  s["SWIFT_VERSION"] = "5.0"
  s["IPHONEOS_DEPLOYMENT_TARGET"] = "16.2"
  s["TARGETED_DEVICE_FAMILY"] = "1"
  s["SKIP_INSTALL"] = "YES"
  s["MARKETING_VERSION"] = app_cfg["MARKETING_VERSION"] || "1.0"
  s["CURRENT_PROJECT_VERSION"] = app_cfg["CURRENT_PROJECT_VERSION"] || "1"
  s["LD_RUNPATH_SEARCH_PATHS"] = ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"]
  s["CODE_SIGN_STYLE"] = "Automatic"
end

# --- embeber la extension en la app (PlugIns) ---
# La fase va ANTES de los scripts de CocoaPods para evitar "Cycle inside App".
embed = project.new(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase)
embed.name = "Embed Foundation Extensions"
embed.symbol_dst_subfolder_spec = :plug_ins
build_file = embed.add_file_reference(ext.product_reference, true)
build_file.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }
app.build_phases.delete(embed)
first_script = app.build_phases.index { |p| p.isa == "PBXShellScriptBuildPhase" && p.name.to_s.include?("Embed Pods") }
idx = first_script || app.build_phases.length
app.build_phases.insert(idx, embed)
app.add_dependency(ext)

project.save
puts "OK: target AlzoLiveActivity agregado (#{EXT_BUNDLE_ID})"
