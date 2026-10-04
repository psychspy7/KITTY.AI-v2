import sharp from "sharp";
import { copyFileSync, existsSync, statSync } from "node:fs";
const master = "assets/brand/kitty-icon-master.png";
if (!existsSync(master)) copyFileSync("assets/brand/kitty-icon.png", master);
await sharp(master)
  .resize(512, 512)
  .png({ compressionLevel: 9 })
  .toFile("assets/brand/kitty-icon.png");
copyFileSync("assets/brand/kitty-icon.png", "admin/public/kitty-icon.png");
copyFileSync(
  "assets/brand/kitty-icon.png",
  "android/app/src/main/res/drawable-nodpi/kitty_icon.png",
);
console.log(
  `Packaged the generated icon at 512px (${statSync("assets/brand/kitty-icon.png").size} bytes); original master preserved locally.`,
);
