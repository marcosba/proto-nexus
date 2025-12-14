function app() {
  return {
    newBlogUrl: '',
    blogs: JSON.parse(localStorage.getItem('protoNexus_blogs') || '[]'),
    posts: [],
    
    async init() {
      // Cargar posts de todos los blogs al iniciar
      await this.loadAllFeeds()
      
      // Recargar cada 30 minutos
      setInterval(() => this.loadAllFeeds(), 30 * 60 * 1000)
    },
    
    async addBlog() {
      if (!this.newBlogUrl) return
      
      // Encontrar URL del feed RSS (heurística básica)
      const blogUrl = this.newBlogUrl.startsWith('http') ? this.newBlogUrl : `https://${this.newBlogUrl}`
      const feedUrl = await this.discoverFeed(blogUrl)
      
      if (feedUrl) {
        const blog = {
          id: Date.now(),
          url: blogUrl,
          feedUrl: feedUrl,
          title: blogUrl.replace('https://', '')
        }
        
        this.blogs.push(blog)
        this.saveBlogs()
        this.newBlogUrl = ''
        
        // Cargar posts de este blog nuevo
        const newPosts = await this.fetchFeed(feedUrl)
        this.posts = [...newPosts, ...this.posts].sort((a,b) => new Date(b.date) - new Date(a.date))
      } else {
        alert('No se pudo encontrar un feed RSS en ese blog')
      }
    },
    
    async discoverFeed(url) {
      // Intentar los endpoints comunes de RSS
      const commonFeeds = [
        `${url}/feed`,
        `${url}/feeds/posts/default`, // Blogger
        `${url}/feed/rss`,
        `${url}/rss`
      ]
      
      // Probar cada uno hasta encontrar uno válido
      for (const feedUrl of commonFeeds) {
        try {
          const response = await fetch(`https://tu-worker.rss-proxy.workers.dev/?url=${encodeURIComponent(feedUrl)}`)
          if (response.ok) return feedUrl
        } catch (e) {}
      }
      
      return null
    },
    
    async fetchFeed(feedUrl) {
      try {
        const response = await fetch(`https://tu-worker.rss-proxy.workers.dev/?url=${encodeURIComponent(feedUrl)}`)
        const posts = await response.json()
        return posts.map(p => ({ ...p, blogUrl: feedUrl.replace(/\/feed.*/, '') }))
      } catch (error) {
        console.error('Error cargando feed:', feedUrl, error)
        return []
      }
    },
    
    async loadAllFeeds() {
      if (this.blogs.length === 0) return
      
      const allPosts = []
      for (const blog of this.blogs) {
        const posts = await this.fetchFeed(blog.feedUrl)
        allPosts.push(...posts)
      }
      
      // Ordenar por fecha (más reciente primero)
      this.posts = allPosts.sort((a,b) => new Date(b.date) - new Date(a.date))
    },
    
    unsubscribe(blogId) {
      this.blogs = this.blogs.filter(b => b.id !== blogId)
      this.saveBlogs()
      this.loadAllFeeds() // Recargar posts
    },
    
    saveBlogs() {
      localStorage.setItem('protoNexus_blogs', JSON.stringify(this.blogs))
    }
  }
}