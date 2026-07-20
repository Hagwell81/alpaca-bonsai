fn main() {
    #[cfg(windows)]
    {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
        let icon_path = std::path::Path::new(&manifest_dir)
            .join("..")
            .join("..")
            .join("resources")
            .join("bonsai-beach.ico");
        if icon_path.exists() {
            let mut res = winres::WindowsResource::new();
            res.set_icon(icon_path.to_str().expect("icon path"));
            res.compile().expect("compile icon resource");
        }
    }
}
