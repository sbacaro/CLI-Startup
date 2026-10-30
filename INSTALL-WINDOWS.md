# Instalar o OpenCode no Windows

Para quem **não programa**. Cada passo é um bloco de comando: copie o bloco
inteiro, cole no PowerShell e aperte Enter. Espere terminar antes de ir ao
próximo. Se um passo mostrar erro em vermelho, pare e mande a mensagem para
quem te passou este guia.

Você vai precisar de: Windows 10 (build 1809 ou mais novo) ou Windows 11,
internet, e sua conta do GitHub.

> Este guia instala tudo direto no Windows. Não precisa de WSL, não precisa de
> Linux, não precisa de Homebrew.

## 1. Abrir o PowerShell

Aperte a tecla `Windows`, digite `PowerShell` e aperte Enter.

Daqui para frente, todo bloco é colado nesta janela.

## 2. Conferir se o instalador de programas existe

O Windows 11 já vem com ele. No Windows 10 pode faltar.

```powershell
winget --version
```

Se aparecer um número de versão, siga para o passo 3. Se aparecer um erro,
instale o **App Installer** pela Microsoft Store: abra a Store, procure por
`App Installer`, clique em Instalar, feche o PowerShell, abra de novo e repita
este passo.

## 3. Instalar os programas base

Cole e espere. Demora vários minutos e cada programa mostra uma barra de
progresso.

```powershell
winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
winget install --id EclipseAdoptium.Temurin.21.JDK -e --accept-source-agreements --accept-package-agreements
winget install --id astral-sh.uv -e --accept-source-agreements --accept-package-agreements
winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
winget install --id yt-dlp.yt-dlp -e --accept-source-agreements --accept-package-agreements
winget install --id UB-Mannheim.TesseractOCR -e --accept-source-agreements --accept-package-agreements
```

Alguns desses programas instalam em pastas que o PowerShell aberto ainda não
conhece. **Feche o PowerShell, abra de novo** e confira:

```powershell
node --version
gh --version
uv --version
```

Cada linha deve mostrar um número de versão. Se alguma disser que o comando não
existe, reinicie o computador e tente de novo.

## 4. Entrar na sua conta do GitHub

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

Ele vai fazer perguntas. Aperte Enter para aceitar o que já vem marcado e
escolha **Login with a web browser**. Copie o código de 8 letras que aparecer,
aperte Enter, cole o código no navegador e autorize.

No fim deve aparecer `✓ Logged in to github.com`. Se não aparecer, rode o
comando de novo.

## 5. Instalar o OpenCode

```powershell
npm install -g @opencode/cli
```

Se o Windows bloquear o comando dizendo que "a execução de scripts foi
desabilitada", rode este primeiro e depois repita o de cima:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Confira:

```powershell
opencode --version
```

## 6. Instalar este plugin

```powershell
opencode plugin add github:sbacaro/CLI-Startup
```

Confira se apareceu na lista:

```powershell
opencode plugin list
```

Deve aparecer uma linha começando com `opencode-startup`.

## 7. Instalar o programa que roda os servidores do GitHub

O GitHub não tem esse programa no winget: ele só é publicado como um arquivo
comprimido. Este bloco baixa, descompacta e deixa pronto.

```powershell
$dir = "$env:LOCALAPPDATA\Programs\github-mcp-server"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/github/github-mcp-server/releases/latest/download/github-mcp-server_Windows_x86_64.zip" -OutFile "$env:TEMP\github-mcp-server.zip"
Expand-Archive -Force -Path "$env:TEMP\github-mcp-server.zip" -DestinationPath $dir
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ([string]::IsNullOrEmpty($userPath)) { $userPath = "" }
if ($userPath -notlike "*$dir*") { [Environment]::SetEnvironmentVariable("Path", ($userPath.TrimEnd(";") + ";" + $dir).TrimStart(";"), "User") }
$env:Path = "$env:Path;$dir"
github-mcp-server --help
```

No fim deve aparecer um texto de ajuda. Feche o PowerShell e abra de novo.

## 8. Instalar o que falta

Abra o OpenCode:

```powershell
opencode
```

Já dentro dele, peça em português mesmo:

```text
Instale tudo que estiver faltando (startup_provision)
```

E aperte Enter. Ele instala o resto sozinho, usando o instalador oficial de
cada ferramenta. Pode pedir permissão: aceite.

Quando terminar, peça:

```text
Mostre o status da instalação (startup_status)
```

Tudo deve aparecer como `current`. Se algo aparecer como `missing`, rode
`startup_provision` de novo.

## 9. Colocar sua chave dos modelos

Ainda dentro do OpenCode, digite:

```text
/connect
```

Escolha **Kodeo**, cole a chave e confirme. Repita para **Globant** se você
tiver a chave dele. A lista de modelos aparece sozinha.

## 10. Entrar nos serviços que pedem login no navegador

Digite:

```text
/mcps
```

Escolha **supabase** e faça login. Depois escolha **cloudflare** e faça login.

## 11. Conferir se está tudo certo

Saia do OpenCode (`Ctrl` + `C` duas vezes) e rode:

```powershell
opencode mcp list
```

Deve aparecer `connected` em: `github`, `graphify`, `rea`, `supabase` e
`cloudflare`. Se algum disser `needs authentication`, faça o passo 10 dele.

Se o GitHub disser que não consegue iniciar, quase sempre é porque o passo 7 foi
feito mas o PowerShell não foi reaberto. Feche, abra e rode de novo.

---

# Opcional: engenharia reversa (REA + Ghidra)

Só faça isto se você vai analisar programas, apps ou binários. O REA também
funciona sem Ghidra para JavaScript, .NET e aplicativos de desktop, então pule
esta parte se não precisar.

## 12. Instalar o REA

```powershell
npm install -g rea-agents
```

## 13. Baixar o Ghidra

O winget não tem o Ghidra. Este bloco baixa a versão 12.1.4, que é a que o REA
aceita, e descompacta na sua pasta de usuário. Cole o bloco inteiro e espere;
são cerca de 550 MB de download.

```powershell
$zip = "$env:TEMP\ghidra_12.1.4_PUBLIC.zip"
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/ghidra_12.1.4_PUBLIC_20260921.zip" -OutFile $zip
Expand-Archive -Force -Path $zip -DestinationPath $env:USERPROFILE
Test-Path "$env:USERPROFILE\ghidra_12.1.4_PUBLIC\Ghidra\Features\Decompiler\os\win_x86_64\decompile.exe"
```

A última linha deve responder `True`. Nada precisa ser compilado: o Windows já
vem com o programa que o Ghidra usa, ao contrário do Mac.

## 14. Apontar o REA para o Ghidra e para o Java

```powershell
$ghidra = "$env:USERPROFILE\ghidra_12.1.4_PUBLIC"
$java = (Split-Path -Parent (Split-Path -Parent (Get-Command javac).Source))
[Environment]::SetEnvironmentVariable("GHIDRA_INSTALL_DIR", $ghidra, "User")
[Environment]::SetEnvironmentVariable("JAVA_HOME", $java, "User")
$env:GHIDRA_INSTALL_DIR = $ghidra
$env:JAVA_HOME = $java
$env:JAVA_HOME
```

Deve aparecer um caminho terminando em algo como
`Eclipse Adoptium\jdk-21...`. Feche o PowerShell, abra de novo e confira:

```powershell
rea doctor --provider ghidra --json
```

Deve começar com `"healthy":true`.

## 15. Registrar o REA no OpenCode

```powershell
rea setup --client opencode --skill --yes
```

Depois abra o OpenCode e rode `startup_status` de novo. O `rea` deve aparecer
como `current`.

## 16. Instalar o Graphify (opcional)

Só se você quiser mapas de código. Cole:

```powershell
uv tool install "graphifyy[mcp]"
graphify install --platform opencode
graphify-mcp --help
```

---

# Se algo deu errado

Cada bloco abaixo desfaz uma parte. Nenhum apaga seus arquivos pessoais nem suas
chaves.

Remover o REA:

```powershell
rea uninstall
```

Remover o Graphify:

```powershell
graphify uninstall
```

Remover o Ghidra e o Java:

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\ghidra_12.1.4_PUBLIC"
winget uninstall EclipseAdoptium.Temurin.21.JDK
```

Para remover as duas variáveis que apontam para eles:

```powershell
[Environment]::SetEnvironmentVariable("GHIDRA_INSTALL_DIR", $null, "User")
[Environment]::SetEnvironmentVariable("JAVA_HOME", $null, "User")
```

Remover o programa do GitHub:

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\github-mcp-server"
```

Remover o plugin:

```powershell
opencode plugin remove opencode-startup
```

## Problemas comuns

**Um comando "não é reconhecido".** O programa foi instalado mas esta janela do
PowerShell é antiga. Feche, abra de novo e repita.

**`startup_provision` falha no GitHub.** Rode o passo 7 de novo. Ele baixa a
versão atual e conserta o caminho.

**`rea` diz `JAVA_HOME must be absolute`.** O `JAVA_HOME` está vazio. Rode o
passo 14 de novo, feche e abra o PowerShell.

**`rea` diz `executable_missing` para Ghidra.** O Ghidra foi apagado ou movido.
Rode os passos 13 e 14 de novo.

**`rea` diz que o Ghidra não tem o programa nativo.** A pasta do Ghidra foi
descompactada no lugar errado. Confira se existe
`%USERPROFILE%\ghidra_12.1.4_PUBLIC\Ghidra\Features\Decompiler\os\win_x86_64\decompile.exe`.
Se existir, rode o passo 14 de novo para apontar o caminho certo.

**`graphify` diz `No module named 'mcp'`.** Foi instalado sem o complemento.
Rode o passo 16 de novo.

**GitHub responde `401`.** Sua conta do GitHub saiu do ar. Rode
`gh auth login --hostname github.com --git-protocol https --web` e reinicie o
OpenCode.

**Um modelo aparece sem preço.** Ele não está no catálogo público. O limite de
uso continua correto.

**Antivírus reclama de um arquivo.** O Ghidra e o programa do GitHub são
programas que leem outros programas, então alguns antivírus estranham. Libere a
pasta `%USERPROFILE%\ghidra_12.1.4_PUBLIC` e a pasta
`%LOCALAPPDATA%\Programs\github-mcp-server`.