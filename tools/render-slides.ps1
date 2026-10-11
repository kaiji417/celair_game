# スライドを PowerPoint で PNG に書き出す（見た目の確認用）
# 使い方: powershell -File tools/render-slides.ps1 <pptx> <出力フォルダ>
param([string]$Pptx, [string]$OutDir)

$Pptx = (Resolve-Path $Pptx).Path
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

$app = New-Object -ComObject PowerPoint.Application
try {
    # 読み取り専用・ウィンドウなしで開く
    $pres = $app.Presentations.Open($Pptx, $true, $false, $false)
    $i = 1
    foreach ($slide in $pres.Slides) {
        $slide.Export((Join-Path $OutDir ("slide{0:D2}.png" -f $i)), "PNG", 1600, 900)
        $i++
    }
    $pres.Close()
} finally {
    $app.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
