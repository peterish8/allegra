plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The add-on is signed with the same key as the LuvLyrics app (the app only talks to an add-on it shares a
// signature with). CI sets ANDROID_RELEASE_KEYSTORE_PATH for main; every other build uses the debug key the main
// app's build also uses.
val releaseKeystorePath: String? = System.getenv("ANDROID_RELEASE_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }
val debugKeystore = rootProject.file("../mobile/android/app/debug.keystore")

android {
    // Not the applicationId: the island code keeps its package (and R) from the app it came out of.
    namespace = "com.lyricflow.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.lyricflow.island"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("shared") {
            if (releaseKeystorePath != null) {
                storeFile = file(releaseKeystorePath)
                storePassword = System.getenv("ANDROID_RELEASE_STORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_RELEASE_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_RELEASE_KEY_PASSWORD")
            } else {
                storeFile = debugKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("shared")
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        // The island logs its geometry in debug builds (com.lyricflow.app.BuildConfig.DEBUG).
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets {
        getByName("main") {
            // The island's typefaces are the app's own SF Pro files, copied in at build time (not kept twice).
            res.srcDir(layout.buildDirectory.dir("generated/fonts/res"))
        }
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        // Robolectric's Android sandbox needs access to these JDK internals on Java 17+.
        unitTests.all {
            it.jvmArgs(
                "--add-opens=java.base/java.lang=ALL-UNNAMED",
                "--add-opens=java.base/java.util=ALL-UNNAMED",
                "--add-opens=java.base/java.io=ALL-UNNAMED",
                "--add-opens=java.base/java.net=ALL-UNNAMED",
                "--add-opens=java.base/java.security=ALL-UNNAMED",
                "--add-opens=java.base/java.text=ALL-UNNAMED",
                "--add-opens=java.base/jdk.internal.access=ALL-UNNAMED",
                "--add-opens=java.desktop/java.awt.font=ALL-UNNAMED",
            )
        }
    }
}

// SF Pro Text -> res/raw, under the names IslandFonts reads (assets_fonts_sfprotext<weight>).
val copyIslandFonts by tasks.registering(Copy::class) {
    val fonts = rootProject.file("../mobile/assets/fonts")
    from(fonts) {
        include("SF-Pro-Text-Regular.otf", "SF-Pro-Text-Semibold.otf", "SF-Pro-Text-Bold.otf")
        rename { name -> "assets_fonts_" + name.lowercase().replace("-", "") }
    }
    into(layout.buildDirectory.dir("generated/fonts/res/raw"))
}
tasks.named("preBuild") { dependsOn(copyIslandFonts) }

dependencies {
    // The island drives the app's player through a MediaController on the app's media session (IslandPlayerLink).
    val media3 = "1.8.0"
    implementation("androidx.media3:media3-session:$media3")
    implementation("androidx.media3:media3-common:$media3")
    implementation("androidx.media3:media3-datasource:$media3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.palette:palette-ktx:1.0.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.17")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.1")
    testImplementation("org.json:json:20240303")
}
