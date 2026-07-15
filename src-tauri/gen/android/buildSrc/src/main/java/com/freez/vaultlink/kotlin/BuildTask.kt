import java.io.File
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val candidates = npmCandidates()
        var lastException: Exception? = null

        for (candidate in candidates) {
            try {
                runTauriCli(candidate)
                return
            } catch (e: Exception) {
                lastException = e
                if (candidate.contains('/') || candidate.contains('\\')) {
                    throw e
                }
            }
        }

        throw lastException ?: GradleException("Unable to locate npm executable")
    }

    private fun npmCandidates(): List<String> {
        val candidates = mutableListOf<String>()
        val env = System.getenv()

        env["NPM_EXECUTABLE"]?.takeIf { it.isNotBlank() }?.let(candidates::add)
        env["NODE_HOME"]?.takeIf { it.isNotBlank() }?.let {
            candidates += listOf("$it/npm.cmd", "$it/npm.exe", "$it/npm.bat")
        }
        env["NPM_HOME"]?.takeIf { it.isNotBlank() }?.let {
            candidates += listOf("$it/npm.cmd", "$it/npm.exe", "$it/npm.bat")
        }

        if (Os.isFamily(Os.FAMILY_WINDOWS)) {
            candidates += listOf(
                "D:/@Software/node.js/npm.cmd",
                "D:/@Software/node.js/npm.exe",
                "npm.cmd",
                "npm.exe",
                "npm.bat",
                "npm",
            )
        } else {
            candidates += listOf("npm")
        }

        return candidates.distinct().filter {
            !it.contains('/') && !it.contains('\\') || File(it).exists()
        }
    }

    private fun appIdentifier(): String {
        val tauriConf = File(project.projectDir, "../../../tauri.conf.json")
        val content = tauriConf.readText(Charsets.UTF_8)
        val match = Regex("\"identifier\"\\s*:\\s*\"([^\"]+)\"").find(content)
        return match?.groupValues?.getOrNull(1)
            ?: throw GradleException("Unable to read app identifier from tauri.conf.json")
    }

    private fun cliOptionsJson(target: String, release: Boolean): String {
        val noiseLevel = if (project.logger.isEnabled(LogLevel.DEBUG)) {
            "FranklyQuitePedantic"
        } else if (project.logger.isEnabled(LogLevel.INFO)) {
            "Polite"
        } else {
            "LoudAndProud"
        }

        return """{"dev":false,"features":[],"args":[],"noise_level":"$noiseLevel","vars":{},"config":[],"target_device":null}"""
    }

    private fun ndkBinDir(): String {
        return "E:/@imFile-Download/AndroidSdk/ndk/29.0.13846066/toolchains/llvm/prebuilt/windows-x86_64/bin"
    }

    private fun linkerForTarget(target: String): String {
        val binDir = ndkBinDir()
        return when (target) {
            "aarch64" -> "$binDir/aarch64-linux-android24-clang.cmd"
            "armv7" -> "$binDir/armv7a-linux-androideabi24-clang.cmd"
            "i686" -> "$binDir/i686-linux-android24-clang.cmd"
            "x86_64" -> "$binDir/x86_64-linux-android24-clang.cmd"
            else -> throw GradleException("Unsupported Android target: $target")
        }
    }

    private fun cargoLinkerEnvName(target: String): String {
        return when (target) {
            "aarch64" -> "CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER"
            "armv7" -> "CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER"
            "i686" -> "CARGO_TARGET_I686_LINUX_ANDROID_LINKER"
            "x86_64" -> "CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER"
            else -> throw GradleException("Unsupported Android target: $target")
        }
    }

    private fun syncFrontendAssets(workingDir: File) {
        val distDir = File(workingDir, "../dist").canonicalFile
        if (!distDir.exists()) {
            throw GradleException("Frontend dist directory is missing: ${distDir.path}")
        }

        val assetsDir = File(project.projectDir, "src/main/assets")
        if (!assetsDir.exists()) {
            assetsDir.mkdirs()
        }

        distDir.walkTopDown().forEach { source ->
            val relative = source.relativeTo(distDir)
            val destination = File(assetsDir, relative.path)

            if (source.isDirectory) {
                if (!destination.exists()) {
                    destination.mkdirs()
                }
            } else {
                destination.parentFile?.mkdirs()
                Files.copy(
                    source.toPath(),
                    destination.toPath(),
                    StandardCopyOption.REPLACE_EXISTING
                )
            }
        }
    }

    private fun abiDirForTarget(target: String): String {
        return when (target) {
            "aarch64" -> "arm64-v8a"
            "armv7" -> "armeabi-v7a"
            "i686" -> "x86"
            "x86_64" -> "x86_64"
            else -> throw GradleException("Unsupported Android target: $target")
        }
    }

    private fun nativeProfileForAndroidDebug(): Boolean {
        // The debug Rust artifact chain has been serving stale libraries on this project.
        // Always sync the freshly built release .so so Android Studio debug installs run the latest code.
        return true
    }

    private fun syncRustLibrary(workingDir: File, target: String, release: Boolean) {
        val profile = if (release || nativeProfileForAndroidDebug()) "release" else "debug"
        val sourceLib = File(
            workingDir,
            "../../exe-location/target/${
                when (target) {
                    "aarch64" -> "aarch64-linux-android"
                    "armv7" -> "armv7-linux-androideabi"
                    "i686" -> "i686-linux-android"
                    "x86_64" -> "x86_64-linux-android"
                    else -> throw GradleException("Unsupported Android target: $target")
                }
            }/$profile/libvaultlink_lib.so"
        ).canonicalFile

        if (!sourceLib.exists() || sourceLib.length() == 0L) {
            throw GradleException("Built Rust library is missing or empty: ${sourceLib.path}")
        }

        val targetDir = File(project.projectDir, "src/main/jniLibs/${abiDirForTarget(target)}")
        if (!targetDir.exists()) {
            targetDir.mkdirs()
        }

        val targetLib = File(targetDir, "libvaultlink_lib.so")
        Files.copy(
            sourceLib.toPath(),
            targetLib.toPath(),
            StandardCopyOption.REPLACE_EXISTING
        )

        if (targetLib.length() == 0L) {
            throw GradleException("Synced Rust library is empty: ${targetLib.path}")
        }
    }

    private fun startOptionsServer(identifier: String, optionsJson: String, workingDir: File): Process {
        val script = File(workingDir, "scripts/android-studio-options-server.mjs")
        if (!script.exists()) {
            throw GradleException("Android Studio options server script is missing: ${script.path}")
        }

        val optionsFile = File.createTempFile("${identifier.replace('.', '_')}-cli-options", ".json")
        optionsFile.writeText(optionsJson, Charsets.UTF_8)
        optionsFile.deleteOnExit()

        val command = listOf(
            "node",
            script.absolutePath,
            identifier,
            optionsFile.absolutePath
        )

        return ProcessBuilder(command)
            .directory(workingDir)
            .redirectErrorStream(true)
            .start()
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val useReleaseRust = release || nativeProfileForAndroidDebug()
        val args = listOf("run", "--", "tauri", "android", "android-studio-script");
        val workingDir = File(project.projectDir, rootDirRel)
        val identifier = appIdentifier()
        syncFrontendAssets(workingDir)
        val optionsServer = startOptionsServer(identifier, cliOptionsJson(target, release), workingDir)
        val linker = linkerForTarget(target)
        val linkerEnv = cargoLinkerEnvName(target)

        try {
            project.exec {
                workingDir(workingDir)
                executable(executable)
                environment(linkerEnv, linker)
                environment("RUSTFLAGS", "")
                args(args)
                if (project.logger.isEnabled(LogLevel.DEBUG)) {
                    args("-vv")
                } else if (project.logger.isEnabled(LogLevel.INFO)) {
                    args("-v")
                }
                if (useReleaseRust) {
                    args("--release")
                }
                args(listOf("--target", target))
            }.assertNormalExitValue()
            syncRustLibrary(workingDir, target, useReleaseRust)
        } finally {
            val output = ByteArrayOutputStream()
            optionsServer.inputStream.copyTo(output)
            optionsServer.waitFor()
            if (project.logger.isEnabled(LogLevel.INFO) && output.size() > 0) {
                project.logger.info(output.toString(Charsets.UTF_8.name()))
            }
        }
    }
}
