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

declare variable $max as xs:integer :=
  try { xs:integer($limit) } catch ($e) { 200 };

(: Escape one regex metacharacter at a time, outside of any character class.
 : A single bracket-expression escaping all metacharacters at once (the
 : previous approach) is invalid in MarkLogic's XSD-flavored regex engine -
 : most of . + ^ $ ( ) { } | lose their special meaning inside [...] and
 : escaping them there raises XDMP-REGEX. Escaping them individually as plain
 : (non-class) atoms is the portable way to do this. Order: backslash first,
 : since later steps must not touch backslashes introduced by earlier ones. :)
declare function local:regex-escape($s as xs:string) as xs:string
{
  let $s := fn:replace($s, '\\', '\\\\')
  let $s := fn:replace($s, '\.', '\\.')
  let $s := fn:replace($s, '\^', '\\^')
  let $s := fn:replace($s, '\$', '\\$')
  let $s := fn:replace($s, '\(', '\\(')
  let $s := fn:replace($s, '\)', '\\)')
  let $s := fn:replace($s, '\[', '\\[')
  let $s := fn:replace($s, '\]', '\\]')
  let $s := fn:replace($s, '\{', '\\{')
  let $s := fn:replace($s, '\}', '\\}')
  let $s := fn:replace($s, '\|', '\\|')
  let $s := fn:replace($s, '\+', '\\+')
  return $s
};

(: Translate a glob (*, ?) into an anchored, case-insensitive regex. :)
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

local:main($pattern)
