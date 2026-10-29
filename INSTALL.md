# Instalar o OpenCode

Para quem **não programa**. Cada passo é um bloco de comando: copie o bloco
inteiro, cole no Terminal e aperte Enter. Espere terminar antes de ir ao
próximo. Se um passo mostrar erro em vermelho, pare e mande a mensagem para
quem te passou este guia.

Você vai precisar de: macOS, internet, e sua conta do GitHub.

## 1. Abrir o Terminal

Aperte `Command` + `Espaço`, digite `Terminal` e aperte Enter.

## 2. Instalar o Homebrew

Cole e espere. Pede a senha do seu Mac (não aparece nada enquanto digita) e
depois aperte Enter. Pode demorar alguns minutos.

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Depois cole este bloco, que deixa o Homebrew disponível agora e nas próximas
vezes:

```sh
grep -q 'brew shellenv' ~/.zprofile 2>/dev/null || echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
brew --version
```

Deve aparecer algo como `Homebrew 4.x.x`.

## 3. Entrar na sua conta do GitHub

Primeiro instale o programa do GitHub:

```sh
brew install gh
```

Agora entre na conta:

```sh
gh auth login --hostname github.com --git-protocol https --web
```

Ele vai fazer perguntas. Aperte Enter para aceitar o que já vem marcado e
escolha **Login with a web browser**. Copie o código de 8 letras que aparecer,
aperte Enter, cole o código no navegador e autorize.

No fim deve aparecer `✓ Logged in to github.com`. Se não aparecer, rode o
comando de novo.

## 4. Instalar os programas base

Cole e espere. Demora alguns minutos.

```sh
brew install node python@3.12 openjdk@21 uv ffmpeg yt-dlp tesseract unar github-mcp-server
```

## 5. Instalar o OpenCode

```sh
npm install -g @opencode/cli
```

## 6. Instalar este plugin

```sh
opencode plugin add github:sbacaro/CLI-Startup
```

Confira se apareceu na lista:

```sh
opencode plugin list
```

Deve aparecer uma linha começando com `opencode-startup`.

## 7. Instalar o que falta

Abra o OpenCode:

```sh
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

## 8. Colocar sua chave dos modelos

Ainda dentro do OpenCode, digite:

```text
/connect
```

Escolha **Kodeo**, cole a chave e confirme. Repita para **Globant** se você
tiver a chave dele. A lista de modelos aparece sozinha.

## 9. Entrar nos serviços que pedem login no navegador

Digite:

```text
/mcps
```

Escolha **supabase** e faça login. Depois escolha **cloudflare** e faça login.

## 10. Conferir se está tudo certo

Saia do OpenCode (`Ctrl` + `C` duas vezes) e rode:

```sh
opencode mcp list
```

Deve aparecer `connected` em: `github`, `graphify`, `rea`, `supabase` e
`cloudflare`. Se algum disser `needs authentication`, faça o passo 9 dele.

---

# Opcional: engenharia reversa (REA + Ghidra)

Só faça isto se você vai analisar programas, apps ou binários. O REA também
funciona sem Ghidra para JavaScript, .NET e aplicativos de desktop, então pule
esta parte se não precisar.

## 11. Instalar o REA

```sh
npm install -g rea-agents
```

## 12. Baixar e preparar o Ghidra

O Homebrew instala a versão 12.2 do Ghidra, que o REA **não** aceita. Este bloco
baixa a 12.1.4 correta, compila o componente que falta no Mac com chip Apple e
confere tudo. Cole o bloco inteiro e espere; leva alguns minutos.

Primeiro, instale as ferramentas de compilação da Apple (pode abrir uma janela
pedindo para instalar; aceite e espere terminar):

```sh
xcode-select -p >/dev/null 2>&1 || xcode-select --install
```

Agora o Ghidra:

```sh
curl -fL "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/ghidra_12.1.4_PUBLIC_20260921.zip" -o "$HOME/Downloads/ghidra_12.1.4_PUBLIC.zip" && unzip -q -o "$HOME/Downloads/ghidra_12.1.4_PUBLIC.zip" -d "$HOME/Library" && cd "$HOME/Library/ghidra_12.1.4_PUBLIC/Ghidra/Features/Decompiler/src/decompile/cpp" && make ghidra_opt ARCH_TYPE="-arch arm64" OSDIR=mac_arm_64 && mkdir -p "$HOME/Library/ghidra_12.1.4_PUBLIC/Ghidra/Features/Decompiler/os/mac_arm_64" && install -m 755 ghidra_opt "$HOME/Library/ghidra_12.1.4_PUBLIC/Ghidra/Features/Decompiler/os/mac_arm_64/decompile" && echo "Ghidra pronto"
```

No fim deve aparecer `Ghidra pronto`.

## 13. Apontar o REA para o Ghidra

```sh
grep -q GHIDRA_INSTALL_DIR ~/.zshrc 2>/dev/null || printf 'export GHIDRA_INSTALL_DIR="$HOME/Library/ghidra_12.1.4_PUBLIC"\nexport JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"\n' >> ~/.zshrc
```

Feche o Terminal, abra de novo e confira:

```sh
rea doctor --provider ghidra --json
```

Deve começar com `"healthy":true`.

## 14. Registrar o REA no OpenCode

```sh
rea setup --client opencode --skill --yes
```

Depois abra o OpenCode e rode `startup_status` de novo. O `rea` deve aparecer
como `current`.

## 15. Instalar o Graphify (opcional)

Só se você quiser mapas de código. Cole:

```sh
uv tool install "graphifyy[mcp]" && graphify install --platform opencode && graphify-mcp --help
```

---

# Se algo deu errado

Cada comando abaixo desfaz uma parte. Nenhum apaga seus arquivos pessoais nem
suas chaves.

Remover o REA:

```sh
rea uninstall
```

Remover o Graphify:

```sh
graphify uninstall
```

Remover o Ghidra e o Java:

```sh
rm -rf "$HOME/Library/ghidra_12.1.4_PUBLIC" && brew uninstall openjdk@21
```

Para remover as duas linhas que apontam para eles, rode:

```sh
sed -i '' '/GHIDRA_INSTALL_DIR/d;/^export JAVA_HOME=/d' ~/.zshrc
```

Remover o plugin:

```sh
opencode plugin remove opencode-startup
```

## Problemas comuns

**`rea` diz `JAVA_HOME must be absolute`.** O `JAVA_HOME` está vazio. Rode o
passo 13 de novo, feche e abra o Terminal.

**`rea` diz `executable_missing` para Ghidra.** O Ghidra foi apagado ou movido.
Rode os passos 12 e 13 de novo.

**`graphify` diz `No module named 'mcp'`.** Foi instalado sem o complemento.
Rode o passo 15 de novo.

**GitHub responde `401`.** Sua conta do GitHub saiu do ar. Rode
`gh auth login --hostname github.com --git-protocol https --web` e reinicie o
OpenCode.

**Um modelo aparece sem preço.** Ele não está no catálogo público. O limite de
uso continua correto.
