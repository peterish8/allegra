// Embeds the Allegra icon as resource 1: Explorer shows it on the exe, and main.rs loads it for
// the title bar and taskbar.
fn main() {
    let mut res = winresource::WindowsResource::new();
    res.set_icon("allegra.ico");
    res.compile().expect("compile Windows resources");
}
