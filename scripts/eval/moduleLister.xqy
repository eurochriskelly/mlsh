xquery version "1.0-ml";

(:
 : Lists module URIs matching a wildcard pattern.
 :
 : Emits one '~'-delimited record per match:
 :   <uri>~<flattened-name>~<permissions>~<collections>~EOL
 :
 : Matching strategy, in order of preference:
 :   1. cts:uri-match  - fast, needs the URI lexicon enabled on the database.
 :   2. cts:uris       - same requirement, used with a regex for robustness.
 :   3. xdmp:directory - full scan fallback for databases with no URI lexicon.
 :
 : Diagnostics are written as 'MLSH-DIAG:' lines so the shell can report why a
 : search came back empty instead of silently claiming "no matches".
 :)

declare variable $pattern as xs:string external;
declare variable $limit as xs:string external := "200";
declare variable $timeoutSeconds as xs:string external := "90";
declare variable $targetDatabase as xs:string external;

declare variable $max as xs:integer :=
  try { xs:integer($limit) } catch ($e) { 200 };

declare variable $timeLimit as xs:integer :=
  try { xs:integer($timeoutSeconds) } catch ($e) { 90 };

(: Escape one regex metacharacter at a time.
 :
 : NOTE: do not implement this with fn:replace($s, pattern, replacement).
 : The *replacement* argument to fn:replace has its own escaping grammar
 : (\ must be followed by \ or a digit; a bare $ is invalid unless written
 : as \$), which is easy to get subtly wrong - e.g. '\\$' is NOT "backslash
 : then dollar", it's "escaped backslash" followed by a dangling, invalid
 : bare $, which raises XDMP-BADREP. Building the escaped string character
 : by character sidesteps that whole class of bug. :)
declare function local:escape-char($c as xs:string) as xs:string
{
  if ($c = ('\', '.', '^', '$', '(', ')', '[', ']', '{', '}', '|', '+'))
  then '\' || $c
  else $c
};

declare function local:regex-escape($s as xs:string) as xs:string
{
  fn:string-join(
    for $cp in fn:string-to-codepoints($s)
    return local:escape-char(fn:codepoints-to-string($cp)),
    ''
  )
};

(: Translate a glob (*, ?) into an anchored, case-insensitive regex.
 : '*' and '?' are handled separately, after escaping, since they must
 : remain wildcards rather than literals. Their replacements ('.*' and '.')
 : contain neither \ nor $, so fn:replace is safe to use for them. :)
declare function local:glob-to-regex($glob as xs:string) as xs:string
{
  let $escaped := local:regex-escape($glob)
  let $wild := fn:replace(fn:replace($escaped, '\*', '.*'), '\?', '.')
  return '^' || $wild || '$'
};

declare function local:by-uri-match($glob as xs:string) as xs:string*
{
  cts:uri-match($glob, ("case-insensitive"))
};

declare function local:by-uris($glob as xs:string) as xs:string*
{
  let $regex := local:glob-to-regex($glob)
  return cts:uris()[fn:matches(., $regex, "i")]
};

declare function local:by-directory-scan($glob as xs:string) as xs:string*
{
  let $regex := local:glob-to-regex($glob)
  for $doc in xdmp:directory("/", "infinity")
  let $uri := fn:base-uri($doc)
  where fn:matches($uri, $regex, "i")
  return $uri
};

(: Try each strategy in turn, remembering which one produced the answer. :)
declare function local:resolve($glob as xs:string) as item()*
{
  let $lexicon :=
    try { local:by-uri-match($glob) }
    catch ($e) {
      ('MLSH-DIAG:uri-match failed: ' ||
        $e/*:code/fn:string() || ' ' || $e/*:message/fn:string())
    }
  return
    if (fn:exists($lexicon) and fn:not($lexicon[1] castable as xs:string and fn:starts-with($lexicon[1], 'MLSH-DIAG:')))
    then ('MLSH-DIAG:strategy=uri-match', $lexicon)
    else
      let $uris :=
        try { local:by-uris($glob) }
        catch ($e) { () }
      return
        if (fn:exists($uris))
        then ($lexicon[fn:starts-with(., 'MLSH-DIAG:')], 'MLSH-DIAG:strategy=cts-uris', $uris)
        else
          let $scan :=
            try { local:by-directory-scan($glob) }
            catch ($e) {
              'MLSH-DIAG:directory scan failed: ' ||
                $e/*:code/fn:string() || ' ' || $e/*:message/fn:string()
            }
          return ($lexicon[fn:starts-with(., 'MLSH-DIAG:')], 'MLSH-DIAG:strategy=directory-scan', $scan)
};

(: Permissions and collections are best-effort: a privilege error on one
 : document must not abort the whole listing. :)
declare function local:describe($uri as xs:string) as xs:string
{
  let $permissions :=
    try {
      xdmp:document-get-permissions($uri) !
        ('perm:' || xdmp:role-name(./*:role-id/xs:integer(.)) || '=' || ./*:capability/fn:string())
    }
    catch ($e) { 'perm:unavailable' }
  let $collections :=
    try { xdmp:document-get-collections($uri) ! ('collection=' || .) }
    catch ($e) { () }
  return fn:string-join((
    $uri,
    fn:replace($uri, '/', '%'),
    fn:string-join($permissions, '#AMP#'),
    fn:string-join($collections, '#AMP#'),
    'EOL'
  ), '~')
};

declare function local:main($glob as xs:string) as xs:string*
{
  if (fn:normalize-space($glob) = '')
  then 'MLSH-DIAG:empty pattern'
  else
    let $resolved := local:resolve($glob)
    let $diagnostics := $resolved[fn:starts-with(., 'MLSH-DIAG:')]
    let $uris := $resolved[fn:not(fn:starts-with(., 'MLSH-DIAG:'))]
    let $total := fn:count($uris)
    return (
      $diagnostics,
      'MLSH-DIAG:pattern=' || $glob,
      'MLSH-DIAG:total=' || $total,
      if ($total > $max)
      then 'MLSH-DIAG:truncated to ' || $max || ' of ' || $total
      else (),
      for $uri in fn:subsequence($uris, 1, $max)
      order by $uri
      return local:describe($uri)
    )
};

(: We deliberately do NOT rely on the REST /v1/eval "db" form field to target
 : $targetDatabase (FS-modules, or whichever modules database). That field
 : makes the REST evaluator itself set up its request context against that
 : database - and if it is a modules-only database (not a general content
 : database), that setup can block indefinitely before this script even
 : starts running, which looks from the client exactly like "the query is
 : slow", with no way to tell the difference from the outside. Instead, the
 : REST call always targets the (healthy, ordinary) content database, and we
 : explicitly hop into $targetDatabase ourselves via xdmp:invoke-function,
 : the same technique the interactive evaluator uses for module-aware
 : xdmp:eval calls. We also force transaction-mode "query" so this
 : read-only listing can never block waiting for a write lock held by some
 : unrelated update transaction on that database. :)
(
  xdmp:set-request-time-limit($timeLimit),
  xdmp:invoke-function(
    function() { local:main($pattern) },
    <options xmlns="xdmp:eval">
      <database>{xdmp:database($targetDatabase)}</database>
      <transaction-mode>query</transaction-mode>
      <isolation>different-transaction</isolation>
    </options>
  )
)
