# Bundled authlib-injector jar

This directory carries the official
[`authlib-injector`](https://github.com/yushijinhun/authlib-injector) jar, which
the launcher attaches to the game JVM as a `-javaagent` so a Yggdrasil session
authenticates against the Loontail auth server instead of Mojang.

The jar is fetched, not committed: `*.jar` here is gitignored. The filename must
match `authlib-injector-<AUTHLIB_INJECTOR_VERSION>.jar`, where
`AUTHLIB_INJECTOR_VERSION` is the constant exported from
`src/main/services/yggdrasil/authlibInjector.ts`. That constant is the input and
the jar is the output — never the other way round.

1. Bump `AUTHLIB_INJECTOR_VERSION` in
   `src/main/services/yggdrasil/authlibInjector.ts`.
2. Run `npm run fetch:authlib-injector` (any `npm run build` does it too, via
   `prebuild`). The script parses the constant and downloads the matching
   release jar into this directory.

`electron-builder.yml` ships this directory to `resources/authlib-injector/` in
the packaged app, and the runtime resolver throws
`YggdrasilError('authlib_injector_missing')` if the jar is absent.

## License

`authlib-injector` is licensed under the GNU Affero General Public License,
version 3, with a documented exception. The full licence text ships inside the
jar at `META-INF/licenses/authlib-injector.txt`; the exception reads:

> "AUTHLIB-INJECTOR" EXCEPTION TO THE AGPL
>
> As a special exception, using this work in the following ways does not cause
> your program to be covered by the AGPL:
>
> a) Bundling the unaltered binary form of this work in your program without
> statically or dynamically linking to it; or
>
> b) Interacting with this work through the provided inter-process
> communication interface, such as the HTTP API; or
>
> c) Loading this work as a Java Agent into a Java Virtual Machine.

The launcher relies on clauses (a) and (c): it ships the jar unaltered and
loads it into the game JVM as a Java agent, so the launcher's own MIT licence
is unaffected. Never patch or repackage the jar — doing so voids clause (a).
`scripts/fetchAuthlibInjector.mjs` pins the expected sha256 of every version it
will vendor, so a patched jar fails the build rather than shipping and quietly
voiding the exception.

### Corresponding source

The exception exempts the launcher's own code from the AGPL; it does not waive
AGPLv3 §6 for authlib-injector itself. The complete corresponding source for the
exact version bundled here is published by the upstream author at
<https://github.com/yushijinhun/authlib-injector/tree/v1.2.5>, under the same
AGPLv3 terms, and is available to any recipient of this program at no charge.
When bumping `AUTHLIB_INJECTOR_VERSION`, update the tag in that URL too.
