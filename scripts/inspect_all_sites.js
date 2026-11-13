const { execOnHyperV } = require('./run_on_hyperv');

async function inspectMirrorSites() {
  const script = `
    for d in /home/vps_mirror/*; do
      if [ -d "$d" ]; then
        name=$(basename "$d")
        if [ "$name" = "openwa" ] || [ "$name" = "srv1069700.hstgr.cloud" ] || [ "$name" = "alma-cyberpanel.localhost" ]; then
          continue
        fi
        
        echo "=== SITE: $name ==="
        
        # Check .env for APP_NAME
        app_name=""
        if [ -f "$d/public_html/.env" ]; then
          app_name=$(grep -E '^APP_NAME=' "$d/public_html/.env" | head -n 1)
        elif [ -f "$d/laravel/.env" ]; then
          app_name=$(grep -E '^APP_NAME=' "$d/laravel/.env" | head -n 1)
        elif [ -f "$d/.env" ]; then
          app_name=$(grep -E '^APP_NAME=' "$d/.env" | head -n 1)
        fi
        [ -n "$app_name" ] && echo "ENV_NAME: $app_name"
        
        # Check title in index.html or index.php
        title=""
        if [ -f "$d/public_html/index.html" ]; then
          title=$(grep -io '<title>[^<]*</title>' "$d/public_html/index.html" | head -n 1)
        elif [ -f "$d/public_html/index.php" ]; then
          title=$(grep -io '<title>[^<]*</title>' "$d/public_html/index.php" | head -n 1)
        fi
        [ -n "$title" ] && echo "TITLE: $title"
        
        # Check frameworks / CMS
        if [ -f "$d/public_html/wp-config.php" ] || [ -f "$d/wp-config.php" ]; then
          echo "CMS: WordPress"
        elif [ -f "$d/public_html/artisan" ] || [ -f "$d/laravel/artisan" ] || [ -f "$d/artisan" ]; then
          echo "FRAMEWORK: Laravel"
        fi
        
        # List top files in public_html
        if [ -d "$d/public_html" ]; then
          echo -n "FILES: "
          ls -1 "$d/public_html" | head -n 8 | tr '\n' ', '
          echo ""
        fi
      fi
    done
  `;

  const res = await execOnHyperV(script);
  console.log(res.stdout);
}

inspectMirrorSites().catch(console.error);
